#!/usr/bin/env bash
#
# Fail closed if homepage branding and Rive routing drift apart.
# Transit is the official app's name; thebonhomme.com must say Rive
# and link to a tree that actually serves the atlas.
#
# WHAT CHANGED, AND WHY
# ---------------------
# The assertions below are unchanged. The way they are EXTRACTED is not.
#
# This guard used to require a <script type="__bundler/template"> block and
# regex `footerLinks:` / `products:` out of the JSON inside it. That tied a
# branding rule to one serialisation format. A hand-authored homepage — plain
# HTML, no bundler — cannot satisfy it, so under `set -euo pipefail` the guard
# failed on a page that was in fact correctly branded. The rule was right; the
# reader was wrong, and the reader is what blocked shipping the right page.
#
# So branding is now read from the RENDERED DOM: headless Chrome loads
# index.html, runs whatever scripts it has, and dumps the resulting document.
# That is the same object a browser and a reader see, whichever way the page
# was authored. A bundled page and a hand-authored page both answer the
# question "what does the footer link say" identically, and so will the next
# format.
#
# Two consequences worth stating:
#   - hrefs are RESOLVED, not string-matched. The bundled page writes
#     "https://thebonhomme.com/rive/" and the hand-authored one writes
#     "/rive/". Those are the same destination and the guard treats them so.
#   - it FAILS CLOSED with no browser. If Chrome is missing the guard exits 2
#     rather than passing, because a branding check that cannot read the page
#     must not report the page as clean.

set -euo pipefail
cd "$(dirname "$0")/.."

# ── locate a headless browser ────────────────────────────────────────────
CHROME="${CHROME_BIN:-}"
if [ -z "$CHROME" ]; then
  for c in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    google-chrome google-chrome-stable chromium chromium-browser \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
  done
fi
if [ -z "$CHROME" ]; then
  echo "FATAL: no headless browser found (set CHROME_BIN)."
  echo "       Refusing to run — this guard reads the rendered DOM, and a"
  echo "       branding check that cannot read the page must not pass it."
  exit 2
fi

# ── self-test ────────────────────────────────────────────────────────────
# Tiny synthetic homepages in BOTH authoring formats: one plain HTML, one that
# builds the very same DOM from JavaScript at load time (what a bundler
# produces). Each format gets a clean case that must pass and three real
# defects that must fail. A guard with no failing case in its own tests is not
# a guard, so these run before every scan.
self_test() {
  local d ok=1 rc
  d="$(mktemp -d -t rivest)"
  python3 - "$d" <<'PX'
import sys, pathlib
d = pathlib.Path(sys.argv[1])
def card(name, href): return (
  '<main><article class="card"><h4>%s</h4><p>Public-transit atlas.</p>'
  '<a class="cta" href="%s">Open %s \u2192</a></article></main>' % (name, href, name))
def footer(fname, drop):
  rive = '' if drop else '<a href="/rive/"><span>%s</span><span>GTFS atlas</span></a>' % fname
  return '<footer><nav><a href="/periodic/"><span>Periodic</span></a>%s</nav></footer>' % rive
def static(f, fname, cname, href, drop=False):
  (d/f).write_text('<!doctype html><meta charset="utf-8"><body>'
                   + card(cname, href) + footer(fname, drop) + '</body>', encoding='utf-8')
def scripted(f, fname, cname, href, drop=False):
  body = (card(cname, href) + footer(fname, drop)).replace('\\', '\\\\').replace("'", "\\'")
  (d/f).write_text('<!doctype html><meta charset="utf-8"><body><div id="r"></div>'
                   "<script>document.getElementById('r').innerHTML='" + body + "';</script></body>",
                   encoding='utf-8')
for tag, mk in (("static", static), ("scripted", scripted)):
    mk(tag+"-clean.html",  "Rive",    "Rive",  "/rive/")
    mk(tag+"-brand.html",  "Transit", "Rive",  "/rive/")
    mk(tag+"-nofoot.html", "Rive",    "Rive",  "/rive/", drop=True)
    mk(tag+"-card.html",   "Rive",    "Ferry", "/rive/")
PX
  for fmt in static scripted; do
    for c in "clean:pass:clean page" "brand:fail:wrong brand string" \
             "nofoot:fail:missing footer link" "card:fail:wrong product card"; do
      local key="${c%%:*}"; local rest="${c#*:}"
      local want="${rest%%:*}"; local label="${rest#*:}"
      rc=0
      RIVE_DOM_ONLY=1 "$0" "$d/$fmt-$key.html" >/dev/null 2>&1 || rc=$?
      if [ "$want" = pass ] && [ "$rc" -eq 0 ]; then echo "  ok    allows $fmt: $label"
      elif [ "$want" = fail ] && [ "$rc" -eq 1 ]; then echo "  ok    flags  $fmt: $label"
      else echo "  BROKEN $fmt: $label (wanted $want, exit $rc)"; ok=0; fi
    done
  done
  [ "$ok" = 1 ] || { echo "self-test FAILED — this guard cannot be trusted."; exit 2; }
}

# The self-test renders eight synthetic pages, so unlike the regex guards it
# is not free. CI runs it as its own step (see design-system-check.yml), the
# same shape check-design-system.sh uses.
if [ "${1:-}" = "--self-test" ]; then
  echo "── self-test"; self_test; echo; echo "self-test passed."; exit 0
fi

# render_dom <html-file> -> stdout: the post-script DOM
render_dom() {
  "$CHROME" --headless --disable-gpu --no-sandbox \
            --virtual-time-budget=10000 --dump-dom "file://$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" 2>/dev/null
}

TARGET="${1:-index.html}"
DOM_FILE="$(mktemp -t rivedom)"
render_dom "$TARGET" > "$DOM_FILE"
if [ ! -s "$DOM_FILE" ]; then
  echo "FATAL: rendering $TARGET produced an empty DOM. Refusing to pass."
  exit 2
fi

DOM_FILE="$DOM_FILE" TARGET="$TARGET" python3 - <<'PY'
import os, re, sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from pathlib import Path

BASE   = "https://thebonhomme.com/"
root   = Path(".")
errors = []
def fail(m): errors.append(m)

dom = Path(os.environ["DOM_FILE"]).read_text(encoding="utf-8", errors="replace")

# ── build a real element tree from the rendered DOM ─────────────────────
# A tree, not a regex over a serialisation. The queries below are then
# structural ("an element inside this card whose whole text is Rive"),
# which is what the branding rule actually means and what survives a
# change of authoring format.
VOID = {"area","base","br","col","embed","hr","img","input","link",
        "meta","param","source","track","wbr"}
SKIP = {"script","style","template","noscript"}

class Node:
    __slots__=("tag","attrs","kids","parent")
    def __init__(self,tag,attrs=None,parent=None):
        self.tag=tag; self.attrs=attrs or {}; self.kids=[]; self.parent=parent

class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root=Node("#root"); self.cur=self.root
    def handle_starttag(self,tag,attrs):
        n=Node(tag,dict(attrs),self.cur); self.cur.kids.append(n)
        if tag not in VOID: self.cur=n
    def handle_startendtag(self,tag,attrs):
        self.cur.kids.append(Node(tag,dict(attrs),self.cur))
    def handle_endtag(self,tag):
        n=self.cur
        while n is not self.root and n.tag!=tag: n=n.parent
        if n is not self.root and n.parent is not None: self.cur=n.parent
    def handle_data(self,d):
        self.cur.kids.append(d)

t=Tree(); t.feed(dom)

def walk(n):
    yield n
    for k in n.kids:
        if isinstance(k,Node): yield from walk(k)

def text_of(n):
    if isinstance(n,str): return n
    if n.tag in SKIP: return ""
    return "".join(text_of(k) for k in n.kids)

def norm(s): return re.sub(r"\s+"," ",s).strip()

def has_ancestor(n,tag):
    p=n.parent
    while p is not None:
        if p.tag==tag: return True
        p=p.parent
    return False

def path_of(u): return urlparse(u).path.rstrip("/") + "/"

anchors=[n for n in walk(t.root) if n.tag=="a" and "href" in n.attrs]
for a in anchors: a_abs=None
resolved=[(a, urljoin(BASE,a.attrs["href"])) for a in anchors]
visible=norm(text_of(t.root))

if not anchors:
    fail("rendered homepage has no anchors at all — did it render?")

# ── 1. the homepage must say Rive, never Transit ────────────────────────
if re.search(r"\bTransit\b", visible):
    fail("homepage visible text still contains the product name Transit")
if any(path_of(u)=="/transit/" for _,u in resolved):
    fail("homepage still links to /transit/")

# ── 2. the footer's last link is Rive → /rive/ ──────────────────────────
foot=[(a,u) for a,u in resolved if has_ancestor(a,"footer")]
if not foot:
    fail("rendered homepage has no footer links")
else:
    a,u = foot[-1]
    if path_of(u)!="/rive/":
        fail("footer last link points at %r, expected /rive/" % u)
    # the NAME must be its own element, not merely a substring of the blurb
    if not any(norm(text_of(e))=="Rive" for e in walk(a)):
        fail("footer last link does not name Rive in its own element (text: %r)"
             % norm(text_of(a))[:70])

# ── 3. the products grid carries a card NAMED Rive → /rive/ ─────────────
# The card region is the anchor itself when the anchor IS the card (bundled),
# or its parent when that parent holds exactly one anchor (hand-authored,
# where the name is an <h4> sibling of the CTA link). Requiring an element
# whose WHOLE text is "Rive" is what distinguishes a card named Rive from a
# card named something else that merely says "Open Rive" on its button.
body=[(a,u) for a,u in resolved if not has_ancestor(a,"footer")]
cards=[a for a,u in body if path_of(u)=="/rive/"]
if not cards:
    fail("products grid has no card linking to /rive/")
else:
    ok=False
    for a in cards:
        region=a
        par=a.parent
        if par is not None and sum(1 for k in walk(par) if getattr(k,"tag",None)=="a")==1:
            region=par
        if any(norm(text_of(e))=="Rive" for e in walk(region)): ok=True; break
    if not ok:
        fail("the /rive/ card is not named Rive (card text: %r)"
             % norm(text_of(cards[0]))[:90])
if any(re.search(r"\bTransit\b", norm(text_of(a))) for a,_ in body):
    fail("products grid still has a Transit card")

# ── 4. the destinations actually exist ──────────────────────────────────
# Skipped under RIVE_DOM_ONLY, which the self-test uses to exercise the DOM
# assertions against synthetic pages without the real site tree.
if os.environ.get("RIVE_DOM_ONLY"):
    if errors:
        print("rive branding: FAIL  (%s)" % os.environ.get("TARGET"))
        for e in errors: print("  -", e)
        sys.exit(1)
    print("rive branding: DOM clean (%s)" % os.environ.get("TARGET")); sys.exit(0)

rive = root / "rive" / "index.html"
if not rive.is_file():
    fail("rive/index.html missing — /rive/ would 404")
elif "<title>Rive" not in rive.read_text(encoding="utf-8", errors="replace"):
    fail("rive/index.html title is not Rive")

alias = root / "transit" / "index.html"
if not alias.is_file():
    fail("transit/index.html missing — /transit/ would 404")
else:
    b = alias.read_text(encoding="utf-8", errors="replace")
    if "/rive/" not in b: fail("transit/index.html does not point at /rive/")
    if re.search(r"\bTransit\b", b): fail("transit alias page still brands as Transit")

watch = root / "transit" / "watch.html"
if not watch.is_file() or "/rive/watch.html" not in watch.read_text(encoding="utf-8", errors="replace"):
    fail("transit/watch.html must 200-alias to /rive/watch.html")

if errors:
    print("rive branding: FAIL  (%s)" % os.environ.get("TARGET"))
    for e in errors: print("  -", e)
    sys.exit(1)
print("rive branding: clean.  (read from the rendered DOM of %s)" % os.environ.get("TARGET"))
print("  homepage products + footer say Rive → /rive/")
print("  /rive/ serves the atlas; /transit/ is a 200 alias")
PY
