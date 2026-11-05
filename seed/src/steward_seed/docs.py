"""Documents: Markdown sources in the profile become PDFs, page images and a page-text corpus.

A document marked ``scanned: true`` is rendered as an image only (no text layer), so the
document service has to OCR it, as with a real scan. The corpus keeps the ground-truth text of
every page; the built-in document backend uses it and the quality eval checks citations against it.
"""

from __future__ import annotations

import io
import random
import re
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import reportlab
from reportlab import rl_config
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

rl_config.invariant = 1  # no timestamps or random ids in PDFs: identical bytes for identical input

PAGE_BREAK = "<!-- page -->"
IMG_W, IMG_H = 1000, 1414  # A4 aspect ratio


@dataclass
class Doc:
    doc_id: str
    title: str
    owner: str
    version: str
    scanned: bool
    pages: list[str] = field(default_factory=list)


def parse(path: Path) -> Doc:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise ValueError(f"{path}: missing front matter")
    meta = yaml.safe_load(m.group(1))
    pages = [p.strip() for p in m.group(2).split(PAGE_BREAK)]
    return Doc(
        doc_id=path.stem,
        title=meta["title"],
        owner=meta["owner"],
        version=str(meta.get("version", "1")),
        scanned=bool(meta.get("scanned", False)),
        pages=[p for p in pages if p],
    )


def plain(markdown: str) -> list[tuple[str, str]]:
    """Markdown → (style, text) lines: h1, h2, row (table) or p."""
    out: list[tuple[str, str]] = []
    para: list[str] = []

    def flush() -> None:
        if para:
            out.append(("p", " ".join(para)))
            para.clear()

    for line in markdown.split("\n"):
        s = line.strip()
        if not s:
            flush()
        elif s.startswith("# "):
            flush()
            out.append(("h1", s[2:]))
        elif s.startswith("## "):
            flush()
            out.append(("h2", s[3:]))
        elif s.startswith("|"):
            flush()
            cells = [c.strip() for c in s.strip("|").split("|")]
            out.append(("row", "   ".join(cells)))
        elif re.match(r"^\d+\. ", s):
            flush()
            out.append(("p", s))
        else:
            para.append(s)
    flush()
    return out


def page_text(markdown: str) -> str:
    return "\n".join(t for _, t in plain(markdown))


_FONTS = Path(reportlab.__file__).parent / "fonts"  # Bitstream Vera, ships with reportlab


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_FONTS / ("VeraBd.ttf" if bold else "Vera.ttf")), size)


def render_image(doc: Doc, page_no: int, markdown: str, rng: random.Random | None) -> Image.Image:
    img = Image.new("L" if doc.scanned else "RGB", (IMG_W, IMG_H), 245 if doc.scanned else (255, 255, 255))
    d = ImageDraw.Draw(img)
    y = 70
    d.text((70, 30), f"{doc.title} · Seite {page_no}", fill=(110 if doc.scanned else (110, 110, 110)), font=_font(18))
    for style, text in plain(markdown):
        size, width, gap = {"h1": (40, 40, 22), "h2": (28, 58, 16), "row": (22, 80, 8), "p": (22, 80, 12)}[style]
        for wrapped in textwrap.wrap(text, width=width) or [""]:
            d.text((70, y), wrapped, fill=(20 if doc.scanned else (20, 20, 20)), font=_font(size, style in ("h1", "h2")))
            y += int(size * 1.35)
        y += gap
    if doc.scanned and rng is not None:
        # A scan: slight rotation, blur and speckles.
        for _ in range(1500):
            d.point((rng.randrange(IMG_W), rng.randrange(IMG_H)), fill=rng.randrange(150, 220))
        img = img.rotate(rng.uniform(-0.8, 0.8), resample=Image.Resampling.BICUBIC, fillcolor=245)
        img = img.filter(ImageFilter.GaussianBlur(0.6))
    return img


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_pdf(doc: Doc, images: list[Image.Image]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, invariant=1)
    c.setTitle(doc.title)
    c.setAuthor("Acme (synthetic)")
    w, h = A4
    for i, md in enumerate(doc.pages):
        if doc.scanned:
            c.drawImage(ImageReader(images[i]), 0, 0, width=w, height=h)
        else:
            y = h - 60
            c.setFont("Helvetica", 9)
            c.drawString(50, h - 35, f"{doc.title} · Seite {i + 1}")
            for style, text in plain(md):
                font, size, width = {"h1": ("Helvetica-Bold", 20, 55), "h2": ("Helvetica-Bold", 14, 75), "row": ("Courier", 10, 95), "p": ("Helvetica", 11, 95)}[style]
                c.setFont(font, size)
                for wrapped in textwrap.wrap(text, width=width) or [""]:
                    c.drawString(50, y, wrapped)
                    y -= size * 1.4
                y -= 6
        c.showPage()
    c.save()
    return buf.getvalue()


def build(docs_dir: Path, seed: int) -> tuple[list[dict[str, Any]], dict[str, bytes]]:
    """Returns the corpus and the files to write (relative path → bytes)."""
    corpus: list[dict[str, Any]] = []
    files: dict[str, bytes] = {}
    for path in sorted(docs_dir.glob("*.md")):
        doc = parse(path)
        rng = random.Random(f"{seed}:{doc.doc_id}")
        images = [render_image(doc, i + 1, md, rng) for i, md in enumerate(doc.pages)]
        files[f"docs/{doc.doc_id}.pdf"] = render_pdf(doc, images)
        for i, img in enumerate(images):
            files[f"pages/{doc.doc_id}/{i + 1}.png"] = png_bytes(img)
        corpus.append(
            {
                "doc_id": doc.doc_id,
                "title": doc.title,
                "owner": doc.owner,
                "version": doc.version,
                "scanned": doc.scanned,
                "pages": [{"page": i + 1, "text": page_text(md)} for i, md in enumerate(doc.pages)],
            }
        )
    return corpus, files
