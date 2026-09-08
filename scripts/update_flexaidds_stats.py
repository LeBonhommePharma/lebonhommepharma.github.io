#!/usr/bin/env python3
"""Refresh FlexAIDdS repo-stat markers on the apex GitHub Pages site.

Patches FlexAIDdS/index.html, flexaid-ds/index.html, and assets/repo-stats.json
in place. Never deletes or rsyncs unrelated routes.

Usage:
    python3 scripts/update_flexaidds_stats.py [--repo OWNER/REPO]
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

HTML_TARGETS = (
    "FlexAIDdS/index.html",
    "flexaid-ds/index.html",
)
STATS_JSON_PATH = "assets/repo-stats.json"
GH_PAGES_SNAPSHOT = (
    "https://raw.githubusercontent.com/LeBonhommePharma/FlexAIDdS/"
    "gh-pages/assets/repo-stats.json"
)

LANG_MAP = {
    "C++": ("cpp", "C++", "#f34b7d"),
    "Python": ("python", "Python", "#3572A5"),
    "Swift": ("swift", "Swift", "#F05138"),
    "Objective-C++": ("objcpp", "Obj-C++", "#438eff"),
    "CMake": ("cmake", "CMake", "#8b949e"),
    "TypeScript": ("ts", "TypeScript", "#3178c6"),
    "Cuda": ("cuda", "CUDA", "#76B900"),
    "CUDA": ("cuda", "CUDA", "#76B900"),
    "C": ("c", "C", "#555555"),
    "Shell": ("other", "Shell", "#89e051"),
    "Metal": ("other", "Metal", "#c4c4c4"),
    "JavaScript": ("other", "JavaScript", "#f1e05a"),
    "HTML": ("other", "HTML", "#e34c26"),
}

MIN_PERCENT = 1.0
OTHER_COLOR = "#555555"


def _request(url: str) -> urllib.request.Request:
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "thebonhomme-flexaidds-stats")
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    return req


def _github_api_get(path: str) -> dict | list | None:
    try:
        with urllib.request.urlopen(_request(f"https://api.github.com{path}"), timeout=15) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"Warning: GitHub API request failed ({path}): {exc}", file=sys.stderr)
        return None


def fetch_commit_count(repo: str) -> int | None:
    url = f"https://api.github.com/repos/{repo}/commits?per_page=1"
    try:
        with urllib.request.urlopen(_request(url), timeout=15) as resp:
            link = resp.headers.get("Link", "")
            match = re.search(r'page=(\d+)>;\s*rel="last"', link)
            if match:
                return int(match.group(1))
            data = json.loads(resp.read().decode())
            if isinstance(data, list):
                return len(data)
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"Warning: GitHub commit count request failed: {exc}", file=sys.stderr)
    return None


def fetch_languages(repo: str) -> dict[str, int]:
    data = _github_api_get(f"/repos/{repo}/languages")
    return data if isinstance(data, dict) else {}


def fetch_stars(repo: str) -> int | None:
    data = _github_api_get(f"/repos/{repo}")
    if data and isinstance(data, dict):
        return data.get("stargazers_count")
    return None


def fetch_latest_release(repo: str) -> str | None:
    data = _github_api_get(f"/repos/{repo}/releases/latest")
    if data and isinstance(data, dict):
        return data.get("tag_name")
    return None


def compute_percentages(languages: dict[str, int]) -> list[tuple[str, str, str, float]]:
    total = sum(languages.values())
    if total == 0:
        return []
    entries: list[tuple[str, str, str, float]] = []
    other_pct = 0.0
    for lang, bytes_count in sorted(languages.items(), key=lambda item: -item[1]):
        pct = round(bytes_count / total * 100, 1)
        if lang in LANG_MAP:
            css_suffix, display, color = LANG_MAP[lang]
            if pct < MIN_PERCENT:
                other_pct += pct
            else:
                entries.append((css_suffix, display, color, pct))
        else:
            other_pct += pct
    if other_pct > 0:
        entries.append(("other", "Other", OTHER_COLOR, round(other_pct, 1)))
    return entries


def count_source_languages(languages: dict[str, int]) -> int:
    return sum(1 for lang in languages if lang != "Makefile")


MARKER_IDS = (
    "stat-commits",
    "stat-langs",
    "stat-stars",
    "last-updated",
    "latest-release",
)


def parse_html_markers(html: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for marker_id in MARKER_IDS:
        match = re.search(rf'id="{re.escape(marker_id)}"[^>]*>([^<]*)<', html)
        if match:
            found[marker_id] = match.group(1).strip()
    return found


def core_fields(snapshot: dict) -> dict[str, str]:
    """Comparable live fields. last-updated is a stamp, not GitHub truth."""
    fields: dict[str, str] = {"stat-commits": str(snapshot["commits"])}
    if snapshot.get("languageCount") is not None:
        fields["stat-langs"] = str(snapshot["languageCount"])
    if snapshot.get("stars") is not None:
        fields["stat-stars"] = str(snapshot["stars"])
    if snapshot.get("latestRelease"):
        fields["latest-release"] = str(snapshot["latestRelease"])
    return fields


def fetch_gh_pages_snapshot() -> dict | None:
    try:
        with urllib.request.urlopen(_request(GH_PAGES_SNAPSHOT), timeout=15) as resp:
            data = json.loads(resp.read().decode())
        return data if isinstance(data, dict) and data.get("commits") else None
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        print(f"Warning: gh-pages snapshot fetch failed: {exc}", file=sys.stderr)
        return None


def patch_html_markers(
    content: str,
    commit_count: int,
    language_count: int | None,
    *,
    stars: int | None = None,
    release: str | None = None,
    last_updated: str | None = None,
) -> str:
    content = re.sub(
        r'(<[^>]*id="stat-commits"[^>]*>)\d+(</[^>]+>)',
        rf"\g<1>{commit_count}\g<2>",
        content,
        count=1,
    )
    if language_count is not None:
        content = re.sub(
            r'(<[^>]*id="stat-langs"[^>]*>)\d+(</[^>]+>)',
            rf"\g<1>{language_count}\g<2>",
            content,
            count=1,
        )
    if stars is not None:
        content = re.sub(
            r'(<span[^>]*id="stat-stars"[^>]*>)\d*(</span>)',
            rf"\g<1>{stars}\g<2>",
            content,
            count=1,
        )
    stamp = last_updated or datetime.date.today().isoformat()
    content = re.sub(
        r'(<span[^>]*id="last-updated"[^>]*>)[^<]*(</span>)',
        rf"\g<1>{stamp}\g<2>",
        content,
        count=1,
    )
    if release:
        content = re.sub(
            r'(<span[^>]*id="latest-release"[^>]*>)[^<]*(</span>)',
            rf"\g<1>{release}\g<2>",
            content,
            count=1,
        )
    return content


def build_snapshot_from_api(repo: str) -> dict | None:
    commits = fetch_commit_count(repo)
    languages = fetch_languages(repo)
    if not commits or not languages:
        return None
    lang_entries = compute_percentages(languages)
    snapshot = {
        "commits": commits,
        "languageCount": count_source_languages(languages),
        "lastUpdated": datetime.date.today().isoformat(),
        "languages": [
            {"id": css, "name": name, "percent": pct, "color": color}
            for css, name, color, pct in lang_entries
        ],
    }
    stars = fetch_stars(repo)
    if stars is not None:
        snapshot["stars"] = stars
    release = fetch_latest_release(repo)
    if release:
        snapshot["latestRelease"] = release
    return snapshot


def apply_snapshot(tree: str, snapshot: dict) -> list[str]:
    commit_count = int(snapshot["commits"])
    language_count = snapshot.get("languageCount")
    if language_count is not None:
        language_count = int(language_count)
    stars = snapshot.get("stars")
    if stars is not None:
        stars = int(stars)
    release = snapshot.get("latestRelease")
    last_updated = snapshot.get("lastUpdated") or datetime.date.today().isoformat()
    changed: list[str] = []

    for relpath in HTML_TARGETS:
        path = os.path.join(tree, relpath)
        if not os.path.isfile(path):
            print(f"Warning: {path} not found, skipping", file=sys.stderr)
            continue
        with open(path, encoding="utf-8") as f:
            original = f.read()
        updated = patch_html_markers(
            original,
            commit_count,
            language_count,
            stars=stars,
            release=release,
            last_updated=last_updated,
        )
        if updated != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(updated)
            changed.append(path)

    json_path = os.path.join(tree, STATS_JSON_PATH)
    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    payload = {
        "commits": commit_count,
        "languageCount": language_count,
        "lastUpdated": last_updated,
        "languages": snapshot.get("languages") or [],
    }
    if stars is not None:
        payload["stars"] = stars
    if release:
        payload["latestRelease"] = release
    serialized = json.dumps(payload, indent=2) + "\n"
    previous = None
    if os.path.isfile(json_path):
        with open(json_path, encoding="utf-8") as f:
            previous = f.read()
    if serialized != previous:
        with open(json_path, "w", encoding="utf-8") as f:
            f.write(serialized)
        changed.append(json_path)
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="LeBonhommePharma/FlexAIDdS")
    parser.add_argument("--tree", default=".", help="Site root to patch")
    parser.add_argument("--from-json", dest="from_json", help="Use this snapshot file")
    args = parser.parse_args()

    snapshot: dict | None = None
    if args.from_json:
        with open(args.from_json, encoding="utf-8") as f:
            snapshot = json.load(f)
    else:
        snapshot = build_snapshot_from_api(args.repo)
        if snapshot is None:
            print("GitHub API incomplete; falling back to FlexAIDdS gh-pages snapshot")
            snapshot = fetch_gh_pages_snapshot()

    if not snapshot or not snapshot.get("commits"):
        print("Error: could not load repo stats", file=sys.stderr)
        return 1

    print(
        "snapshot:",
        snapshot.get("commits"),
        "commits,",
        snapshot.get("stars"),
        "stars,",
        snapshot.get("latestRelease"),
        snapshot.get("lastUpdated"),
    )
    changed = apply_snapshot(args.tree, snapshot)
    if changed:
        for path in changed:
            print(f"Updated {path}")
    else:
        print("No changes needed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
