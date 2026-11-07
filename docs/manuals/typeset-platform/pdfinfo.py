"""Helpers for build.mjs: read the outline (h1 bookmarks -> page numbers) and run layout checks.

usage: python3 -I pdfinfo.py outline <pdf>
       python3 -I pdfinfo.py check <pdf> <headings.json>
"""
import io
import json
import subprocess
import sys

from pypdf import PdfReader


def outline(pdf):
    r = PdfReader(pdf)
    out = []

    def walk(items, level):
        for it in items:
            if isinstance(it, list):
                walk(it, level + 1)
            else:
                try:
                    pg = r.get_destination_page_number(it) + 1
                except Exception:
                    pg = None
                out.append({"title": it.title, "level": level, "page": pg})

    walk(r.outline, 0)
    print(json.dumps({"pages": len(r.pages), "outline": out}, ensure_ascii=False))


def norm(s):
    return set(w.strip(".,:;()\"'") for w in s.split() if w.strip(".,:;()\"'"))


def check(pdf, headings_json):
    heads = json.load(open(headings_json, encoding="utf-8"))
    hsets = [(h, norm(h)) for h in heads if h.strip()]
    n = len(PdfReader(pdf).pages)
    problems = []
    for p in range(1, n + 1):
        txt = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), "-layout", pdf, "-"],
                             capture_output=True, text=True).stdout
        lines = [l.strip() for l in txt.splitlines() if l.strip()]
        body = [l for l in lines if "ask@spamanagement.co" not in l and not l.isdigit()]
        if not body:
            continue
        last = body[-1]
        ls = norm(last)
        for h, hs in hsets:
            if hs and ls and (hs == ls or (len(hs) > 2 and hs <= ls and len(ls) - len(hs) <= 1)):
                problems.append({"page": p, "last_line": last, "heading": h})
                break
    print(json.dumps({"pages": n, "orphans": problems}, ensure_ascii=False, indent=1))




def fixoutline(pdf, titles_json):
    """Chromium writes bookmark titles from the laid-out lines: wrapped lines lose their space and
    right-to-left titles come out in visual word order. Bookmarks follow the document's headings one
    to one, so rewrite every title from the real heading texts, in order."""
    from pypdf import PdfWriter
    from pypdf.generic import NameObject, TextStringObject

    titles = json.load(open(titles_json, encoding="utf-8"))
    w = PdfWriter(clone_from=pdf)
    items = []

    def walk(node):
        while node is not None:
            item = node.get_object()
            items.append(item)
            if "/First" in item:
                walk(item["/First"])
            node = item.get("/Next")

    root = w._root_object
    if "/Outlines" in root and "/First" in root["/Outlines"].get_object():
        walk(root["/Outlines"].get_object()["/First"])
    if len(items) != len(titles):
        raise SystemExit(f"outline has {len(items)} entries, expected {len(titles)}")
    for item, t in zip(items, titles):
        # Bidi isolate marks (U+2066-2069) help the HTML only; some viewers draw them as boxes in bookmarks.
        item[NameObject("/Title")] = TextStringObject("".join(c for c in t if not 0x2066 <= ord(c) <= 0x2069))
    w.write(pdf)
    print(json.dumps({"fixed": len(items)}))


def resize(jobs_json):
    """Downscale screenshots to ~220 dpi at their printed width (Chromium embeds images at full size)."""
    from PIL import Image

    jobs = json.load(open(jobs_json, encoding="utf-8"))
    outs = []
    for j in jobs:
        im = Image.open(j["src"])
        if im.width > j["px"]:
            h = round(im.height * j["px"] / im.width)
            im = im.convert("RGB").resize((j["px"], h), Image.LANCZOS)
        else:
            im = im.convert("RGB")
        # Keep whichever is smaller: lossless PNG or a high-quality JPEG (no chroma subsampling, so
        # text stays crisp). Chromium passes JPEG data through but re-compresses PNG losslessly.
        png, jpg = io.BytesIO(), io.BytesIO()
        im.save(png, "PNG", optimize=True)
        im.save(jpg, "JPEG", quality=90, subsampling=0, optimize=True)
        data, ext = (png, ".png") if png.tell() <= jpg.tell() else (jpg, ".jpg")
        out = j["out"] + ext
        with open(out, "wb") as fh:
            fh.write(data.getvalue())
        outs.append(out)
    print(json.dumps({"outs": outs}))


def layout(pdf):
    """Per page (body band only, mm from the page top): where the text starts and ends, and the first screenshot on
    the page (its index over the whole document). Screenshots are the only raster images; poppler is fast enough to
    run between print passes."""
    import re

    mm = 72 / 25.4
    xml = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], capture_output=True, text=True).stdout
    pages = []
    for chunk in xml.split("<page ")[1:]:
        tops, bots = [], []
        for m in re.finditer(r'<line xMin="[^"]+" yMin="([^"]+)" xMax="[^"]+" yMax="([^"]+)"', chunk):
            t, b = float(m.group(1)) / mm, float(m.group(2)) / mm
            if t >= 20 and b <= 280:
                tops.append(t)
                bots.append(b)
        pages.append({"top": round(min(tops, default=279), 1), "bottom": round(max(bots, default=21), 1)})
    lst = subprocess.run(["pdfimages", "-list", pdf], capture_output=True, text=True).stdout.splitlines()[2:]
    counts = {}
    for l in lst:
        pg = int(l.split()[0])
        counts[pg] = counts.get(pg, 0) + 1
    gi = 0
    for i, pg in enumerate(pages, 1):
        pg["firstImg"] = gi if counts.get(i) else None
        gi += counts.get(i, 0)
    print(json.dumps(pages))


def lines(pdf, pages_csv):
    """Body text lines (header/footer removed) on each listed page."""
    out = {}
    for pg in pages_csv.split(","):
        txt = subprocess.run(["pdftotext", "-f", pg, "-l", pg, "-layout", pdf, "-"], capture_output=True, text=True).stdout
        ls = [l for l in txt.splitlines() if l.strip()]
        out[pg] = max(0, len(ls) - 2)
    print(json.dumps(out))


if __name__ == "__main__":
    {"outline": lambda: outline(sys.argv[2]), "check": lambda: check(sys.argv[2], sys.argv[3]),
     "fixoutline": lambda: fixoutline(sys.argv[2], sys.argv[3]),
     "resize": lambda: resize(sys.argv[2]),
     "layout": lambda: layout(sys.argv[2]),
     "lines": lambda: lines(sys.argv[2], sys.argv[3])}[sys.argv[1]]()
