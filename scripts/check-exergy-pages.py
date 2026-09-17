#!/usr/bin/env python3
"""Contracts for public Exergy pages. A check that cannot fail is not a check."""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILS: list[str] = []

PAGES = (
    ROOT / "Exergy/index.html",
    ROOT / "Exergy/support/index.html",
    ROOT / "Exergy/privacy/index.html",
)
CSS = ROOT / "Exergy/exergy.css"
HOME = ROOT / "index.html"

RETIRED = ("#FBBF24", "#fbbf24", "#22D3EE", "#22d3ee")


def fail(msg: str) -> None:
    FAILS.append(msg)


def check_page(path: Path, canonical: str, title_needle: str) -> None:
    if not path.is_file():
        try:
            loc = path.relative_to(ROOT)
        except ValueError:
            loc = path
        fail(f"missing {loc}")
        return
    text = path.read_text(encoding="utf-8")
    if 'href="/tokens.css"' not in text:
        fail(f"{path.name} must link /tokens.css (no local :root palette)")
    if 'href="/theme.css"' not in text:
        fail(f"{path.name} must link /theme.css")
    if 'href="#main"' not in text and "Skip to main content" not in text:
        fail(f"{path.name} missing skip link to #main")
    if 'id="main"' not in text:
        fail(f"{path.name} main landmark must have id=main")
    if canonical not in text:
        fail(f"{path.name} missing canonical {canonical}")
    if title_needle not in text:
        fail(f"{path.name} missing title/copy {title_needle!r}")
    for bad in RETIRED:
        if bad in text:
            fail(f"{path.name} contains retired hue {bad}")


def check_css(text: str) -> None:
    if "min-height: 44px" not in text:
        fail("exergy.css nav hits must be at least 44px")
    if "prefers-reduced-motion" not in text:
        fail("exergy.css must honor prefers-reduced-motion")
    if ":focus-visible" not in text:
        fail("exergy.css must have :focus-visible")
    if "cursor: pointer" not in text:
        fail("exergy.css clickable elements must set cursor: pointer")
    if "#C4A359" in text or "#c4a359" in text:
        fail("exergy.css must use site tangerine, not native chrome gold")
    for bad in RETIRED:
        if bad in text:
            fail(f"exergy.css contains retired hue {bad}")
    if "#FF9300" not in text and "var(--tangerine" not in text:
        fail("exergy.css kicker/focus must use site tangerine, not chrome gold")
    if "exergy-rings" not in text:
        fail("exergy.css must keep remaining-first ring chrome")
    if re.search(r"var\(--[^)]+,\s*#", text):
        fail("exergy.css components must not use hex fallbacks in var()")


def check_home(text: str) -> None:
    if 'href="/Exergy/"' not in text:
        fail("homepage must link /Exergy/")
    if ">Exergy" not in text and "Exergy <" not in text:
        fail("homepage must name Exergy")
    if "Remaining work" not in text and "remaining" not in text.lower():
        fail("homepage Exergy card must say remaining work")
    if "min-height: 44px" not in text and "min-height:44px" not in text:
        fail("homepage card CTAs must keep a 44px hit")
    if "#FBBF24" in text or "#fbbf24" in text:
        fail("homepage must not use retired gold #FBBF24")


def check_privacy(text: str) -> None:
    blob = text.lower()
    for needle in ("data not collected", "keychain", "cloudkit"):
        if needle not in blob:
            fail(f"privacy page missing {needle}")
    if "never written to cloudkit" not in blob:
        fail("privacy page must say tokens are not written to CloudKit")


def check_support(text: str) -> None:
    if "iCloud.com.lebonhommepharma.exergy" not in text:
        fail("support page must name the private CloudKit container")
    if "exergy://oauth" not in text:
        fail("support page must name the OAuth redirect")
    if "inventing" not in text.lower() and "invent" not in text.lower():
        fail("support must say empty rings rather than inventing percents")


def scan_repo() -> None:
    check_page(PAGES[0], "https://thebonhomme.com/Exergy/", "Exergy")
    check_page(PAGES[1], "https://thebonhomme.com/Exergy/support/", "Support")
    check_page(PAGES[2], "https://thebonhomme.com/Exergy/privacy/", "Privacy")
    if CSS.is_file():
        check_css(CSS.read_text(encoding="utf-8"))
    else:
        fail("missing Exergy/exergy.css")
    if HOME.is_file():
        check_home(HOME.read_text(encoding="utf-8"))
    else:
        fail("missing index.html")
    if PAGES[2].is_file():
        check_privacy(PAGES[2].read_text(encoding="utf-8"))
    if PAGES[1].is_file():
        check_support(PAGES[1].read_text(encoding="utf-8"))
    pointer = ROOT / "Exergy/icon-workorder.md"
    if not pointer.is_file():
        fail("missing Exergy/icon-workorder.md pointer")
        return
    ptxt = pointer.read_text(encoding="utf-8")
    if "CLAUDE_DESIGN_ICON_WORKORDER" not in ptxt:
        fail("icon-workorder.md must point at the ShannonUI canonical workorder")
    for bad in RETIRED:
        if bad in ptxt:
            fail("icon-workorder.md must not name retired hexes (palette gate)")


def self_test() -> int:
    """Prove the checks can still fail. Exit 2 if the harness is broken."""
    broken: list[str] = []

    def run(fn, *args) -> list[str]:
        global FAILS
        FAILS = []
        fn(*args)
        out = list(FAILS)
        FAILS = []
        return out

    missing = run(
        check_page,
        Path("/tmp/no-such-exergy.html"),
        "https://thebonhomme.com/Exergy/",
        "Exergy",
    )
    if not any("missing" in m for m in missing):
        broken.append("check_page no longer flags a missing file")

    page_bad = (
        "<title>Exergy</title>\n"
        '<link rel="canonical" href="https://thebonhomme.com/Exergy/">\n'
        "color: #FBBF24;\n"
    )
    # Write a temp page inside ROOT? Use check on a real tempfile via check_page after
    # injecting through a helper: retired hex on CSS is enough if check_css fires.
    misses = run(check_css, "a { color: #FBBF24; min-height: 20px; }")
    if not any("44px" in m or "retired" in m or "tangerine" in m for m in misses):
        broken.append("check_css no longer flags short hits / retired gold")
    if not any("retired" in m for m in misses):
        broken.append("check_css no longer flags retired gold")

    css_ok = run(
        check_css,
        "a { min-height: 44px; cursor: pointer; } .exergy-rings {} "
        "@media (prefers-reduced-motion: reduce) {} "
        "a:focus-visible { outline: 2px solid var(--tangerine); }",
    )
    if css_ok:
        broken.append(f"check_css false-positives on valid CSS: {css_ok}")

    home_bad = run(check_home, "<html>no card</html>")
    if not any("/Exergy/" in m for m in home_bad):
        broken.append("check_home no longer requires /Exergy/")

    priv_bad = run(check_privacy, "<p>hello</p>")
    if not any("data not collected" in m for m in priv_bad):
        broken.append("check_privacy no longer fail-closes on missing copy")
    if not any("cloudkit" in m for m in priv_bad):
        broken.append("check_privacy no longer requires CloudKit sentence")

    # Retired fill on a page must be caught when the file exists.
    with tempfile.TemporaryDirectory() as tmp:
        fake = Path(tmp) / "index.html"
        fake.write_text(page_bad, encoding="utf-8")
        page_hits = run(
            check_page,
            fake,
            "https://thebonhomme.com/Exergy/",
            "Exergy",
        )
    if not any("tokens.css" in m or "retired" in m for m in page_hits):
        broken.append("check_page no longer flags missing tokens.css / retired hue")

    if broken:
        print("self-test FAILED")
        for item in broken:
            print(" -", item)
        return 2
    print("self-test passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    print("── self-test")
    rc = self_test()
    if rc:
        return rc
    print("── scan")
    scan_repo()
    if FAILS:
        print("FAIL")
        for item in FAILS:
            print(" -", item)
        return 1
    print("OK Exergy pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
