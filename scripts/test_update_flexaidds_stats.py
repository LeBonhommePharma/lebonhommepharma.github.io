#!/usr/bin/env python3
"""Tests for scripts/update_flexaidds_stats.py — surgical marker patching."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import update_flexaidds_stats as stats  # noqa: E402


SAMPLE = (
    '<span id="stat-commits" hidden>2000</span>\n'
    '<span id="stat-langs" hidden>14</span>\n'
    '<span id="stat-stars" hidden>9</span>\n'
    '<span id="last-updated" hidden>2026-07-25</span>\n'
    '<span id="latest-release" hidden>v2.0.0</span>\n'
)


class TestPatchMarkers(unittest.TestCase):
    def test_replaces_markers(self) -> None:
        out = stats.patch_html_markers(
            SAMPLE,
            2553,
            15,
            stars=11,
            release="v2.2.0",
            last_updated="2026-09-08",
        )
        self.assertIn(">2553<", out)
        self.assertIn(">15<", out)
        self.assertIn(">11<", out)
        self.assertIn(">2026-09-08<", out)
        self.assertIn(">v2.2.0<", out)

    def test_apply_snapshot_does_not_touch_other_routes(self) -> None:
        snapshot = {
            "commits": 2553,
            "languageCount": 15,
            "lastUpdated": "2026-09-08",
            "stars": 11,
            "latestRelease": "v2.2.0",
            "languages": [
                {"id": "cpp", "name": "C++", "percent": 50.7, "color": "#f34b7d"},
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "FlexAIDdS").mkdir()
            (root / "flexaid-ds").mkdir()
            (root / "assets").mkdir()
            (root / "rive").mkdir()
            (root / "FlexAIDdS" / "index.html").write_text(SAMPLE, encoding="utf-8")
            (root / "flexaid-ds" / "index.html").write_text(SAMPLE, encoding="utf-8")
            (root / "rive" / "keep-me.txt").write_text("atlas\n", encoding="utf-8")
            changed = stats.apply_snapshot(str(root), snapshot)
            self.assertTrue((root / "rive" / "keep-me.txt").is_file())
            self.assertEqual(
                (root / "rive" / "keep-me.txt").read_text(encoding="utf-8"),
                "atlas\n",
            )
            self.assertTrue(any(path.endswith("FlexAIDdS/index.html") for path in changed))
            payload = json.loads((root / "assets" / "repo-stats.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["commits"], 2553)
            self.assertEqual(payload["stars"], 11)
            self.assertEqual(payload["latestRelease"], "v2.2.0")


class TestParseMarkers(unittest.TestCase):
    def test_parse_html_markers(self) -> None:
        found = stats.parse_html_markers(SAMPLE)
        self.assertEqual(found["stat-commits"], "2000")
        self.assertEqual(found["latest-release"], "v2.0.0")

    def test_core_fields(self) -> None:
        fields = stats.core_fields(
            {
                "commits": 2553,
                "languageCount": 15,
                "stars": 11,
                "latestRelease": "v2.2.0",
                "lastUpdated": "2026-09-08",
            }
        )
        self.assertEqual(
            fields,
            {
                "stat-commits": "2553",
                "stat-langs": "15",
                "stat-stars": "11",
                "latest-release": "v2.2.0",
            },
        )


class TestFailsLoudOnZero(unittest.TestCase):
    """A patcher that patches nothing must not pass."""

    SNAP = {"commits": 2553, "languageCount": 15, "lastUpdated": "2026-09-08",
            "stars": 11, "latestRelease": "v2.2.0", "languages": []}

    def _tree(self, root: Path, html: str) -> None:
        for d in ("FlexAIDdS", "flexaid-ds", "assets"):
            (root / d).mkdir()
        (root / "FlexAIDdS" / "index.html").write_text(html, encoding="utf-8")
        (root / "flexaid-ds" / "index.html").write_text(html, encoding="utf-8")

    def test_missing_marker_raises_and_names_it(self) -> None:
        broken = SAMPLE.replace('id="stat-commits"', 'id="stat-commit-count"')
        with self.assertRaisesRegex(stats.MarkerError, "stat-commits"):
            stats.patch_html_markers(broken, 1, 1, last_updated="2026-09-08")

    def test_page_with_no_markers_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._tree(root, "<html><body>rewritten template</body></html>")
            with self.assertRaisesRegex(stats.MarkerError, "FlexAIDdS/index.html"):
                stats.apply_snapshot(str(root), self.SNAP)

    def test_missing_target_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._tree(root, SAMPLE)
            (root / "flexaid-ds" / "index.html").unlink()
            with self.assertRaises(FileNotFoundError):
                stats.apply_snapshot(str(root), self.SNAP)

    def test_second_run_is_a_no_op(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._tree(root, SAMPLE)
            first = stats.apply_snapshot(str(root), self.SNAP)
            before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
            second = stats.apply_snapshot(str(root), self.SNAP)
            after = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
            self.assertEqual(len(first), 3)
            self.assertEqual(second, [])
            self.assertEqual(before, after)
            html = (root / "FlexAIDdS" / "index.html").read_text(encoding="utf-8")
            self.assertEqual(html.count(">2553<"), 1)


if __name__ == "__main__":
    unittest.main()
