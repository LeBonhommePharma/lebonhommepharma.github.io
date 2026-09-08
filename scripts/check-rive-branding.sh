#!/usr/bin/env bash
#
# Fail closed if homepage branding and Rive routing drift apart.
# Transit is the official app's name; thebonhomme.com must say Rive
# and link to a tree that actually serves the atlas.

set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import json, re, sys
from pathlib import Path

root = Path(".")
errors = []

def fail(msg):
    errors.append(msg)

text = (root / "index.html").read_text(encoding="utf-8")
m = re.search(r'<script type="__bundler/template">\s*(.*?)\s*</script>', text, re.S)
if not m:
    fail("homepage bundle has no __bundler/template")
    tmpl = ""
else:
    tmpl = json.loads(m.group(1))

if re.search(r'\bTransit\b', tmpl):
    fail("homepage template still contains the product name Transit")

if 'https://thebonhomme.com/transit/' in tmpl:
    fail("homepage still links to /transit/")

footer = re.search(r'footerLinks: \[([\s\S]*?)\],\n      pipeline:', tmpl)
products = re.search(r'products: \[([\s\S]*?)\],\n      principles:', tmpl)
if not footer:
    fail("could not parse footerLinks")
else:
    names = re.findall(r'name: "([^"]+)"', footer.group(1))
    if not names or names[-1] != "Rive":
        fail("footer last link is %r, expected Rive" % (names[-1] if names else None))
    if 'href: "https://thebonhomme.com/rive/"' not in footer.group(1):
        fail("footer has no Rive link to https://thebonhomme.com/rive/")

if not products:
    fail("could not parse products")
else:
    names = re.findall(r'name: "([^"]+)"', products.group(1))
    if "Rive" not in names:
        fail("products grid has no Rive card")
    if "Transit" in names:
        fail("products grid still has a Transit card")
    if 'href: "https://thebonhomme.com/rive/"' not in products.group(1):
        fail("Rive product card does not link to /rive/")

rive = root / "rive" / "index.html"
if not rive.is_file():
    fail("rive/index.html missing — /rive/ would 404")
else:
    body = rive.read_text(encoding="utf-8", errors="replace")
    if "<title>Rive" not in body:
        fail("rive/index.html title is not Rive")

alias = root / "transit" / "index.html"
if not alias.is_file():
    fail("transit/index.html missing — /transit/ would 404")
else:
    body = alias.read_text(encoding="utf-8")
    if "/rive/" not in body:
        fail("transit/index.html does not point at /rive/")
    if re.search(r'\bTransit\b', body):
        fail("transit alias page still brands as Transit")

watch = root / "transit" / "watch.html"
if not watch.is_file() or "/rive/watch.html" not in watch.read_text(encoding="utf-8"):
    fail("transit/watch.html must 200-alias to /rive/watch.html")

if errors:
    print("rive branding: FAIL")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("rive branding: clean.")
print("  homepage products + footer say Rive → /rive/")
print("  /rive/ serves the atlas; /transit/ is a 200 alias")
PY
