#!/usr/bin/env python3
"""Fail closed if live thebonhomme.com FlexAIDdS stats drift from GitHub.

Checks, in order:
  1. /assets/repo-stats.json  (what live /FlexAIDdS/sections.jsx fetches)
  2. /flexaid-ds/ HTML markers (served from this repo)
  3. /FlexAIDdS/ HTML markers (FlexAIDdS project Pages overlay)

A green FlexAIDdS update-site.yml is not enough: that job swallows a 403 on
the usersite push and does not call deploy-pages. This script is the gate
that cannot succeed while the public numbers stay stale.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import update_flexaidds_stats as stats  # noqa: E402

LIVE_JSON = "https://thebonhomme.com/assets/repo-stats.json"
LIVE_HTML = {
    "flexaid-ds": "https://thebonhomme.com/flexaid-ds/",
    "FlexAIDdS": "https://thebonhomme.com/FlexAIDdS/",
}

OVERLAY_HINT = (
    "/FlexAIDdS/ HTML is served by LeBonhommePharma/FlexAIDdS project Pages "
    "(build_type=workflow), which overlays this repo's FlexAIDdS/ folder. "
    "update-site.yml pushes gh-pages and then `sync_apex_to_usersite.sh || echo warning`; "
    "the usersite push 403s and deploy-pages was removed, so the live artifact froze. "
    "Apply patches/flexaidds-restore-pages-deploy.patch in FlexAIDdS and re-run Deploy Site."
)


def fetch_text(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "thebonhomme-flexaidds-stats-verify",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def compare_fields(actual: dict[str, str], expected: dict[str, str], label: str) -> list[str]:
    errors: list[str] = []
    for key, want in expected.items():
        got = actual.get(key)
        if str(got) != str(want):
            errors.append(f"{label} {key}: live={got!r} expected={want!r}")
    return errors


def check_once(expected: dict[str, str]) -> list[str]:
    errors: list[str] = []

    raw = fetch_text(LIVE_JSON)
    payload = json.loads(raw)
    live_json = {
        "stat-commits": str(payload.get("commits")),
        "stat-langs": str(payload.get("languageCount")),
        "stat-stars": str(payload.get("stars")),
        "latest-release": str(payload.get("latestRelease")),
    }
    errors.extend(compare_fields(live_json, expected, LIVE_JSON))

    for name, url in LIVE_HTML.items():
        markers = stats.parse_html_markers(fetch_text(url))
        html_errors = compare_fields(markers, expected, url)
        if html_errors and name == "FlexAIDdS":
            html_errors.append(OVERLAY_HINT)
        errors.extend(html_errors)

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="LeBonhommePharma/FlexAIDdS")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--interval", type=int, default=15)
    parser.add_argument(
        "--from-json",
        dest="from_json",
        help="Compare against this snapshot instead of calling GitHub",
    )
    args = parser.parse_args()

    if args.from_json:
        with open(args.from_json, encoding="utf-8") as f:
            snapshot = json.load(f)
    else:
        snapshot = stats.build_snapshot_from_api(args.repo)
        if snapshot is None:
            snapshot = stats.fetch_gh_pages_snapshot()
    if not snapshot or not snapshot.get("commits"):
        print("Error: could not load expected GitHub stats", file=sys.stderr)
        return 1

    expected = stats.core_fields(snapshot)
    print("expected:", expected)

    deadline = time.time() + args.timeout
    last = ["verify not attempted"]
    while time.time() < deadline:
        try:
            last = check_once(expected)
            if not last:
                print("live JSON + /flexaid-ds/ + /FlexAIDdS/ match GitHub")
                return 0
            print("not yet:", "; ".join(last), flush=True)
        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as exc:
            last = [str(exc)]
            print(f"fetch failed: {exc}", flush=True)
        time.sleep(args.interval)

    print("live FlexAIDdS stats still stale after timeout:", file=sys.stderr)
    print("\n".join(last), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
