"""Builds the quiz guides in /resources/ from the text files in scripts/pdfs/.

Needs reportlab and the static Montserrat fonts (Light, Regular, SemiBold, Bold .ttf):
    venv/bin/python -I scripts/pdfs.py <folder with Montserrat-*.ttf>

Text format, one item per line:
    # Title                  Subtitle: line under the title
    ## Section heading       - bullet      1. numbered step
    CTA: Heading | Text | link shown at the end
Anything else is a paragraph. Same copy rules as the site: no em or en dashes, curly double quotes.
"""
import re
import sys
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "pdfs"
OUT = ROOT / "resources"

BLUE, LIGHT_BLUE, CYAN, NAVY = HexColor("#4D74F2"), HexColor("#62AFF9"), HexColor("#22D3EE"), HexColor("#0A1022")
INK, MUTED, PANEL = HexColor("#1B2236"), HexColor("#55607A"), HexColor("#EEF4FE")

S = {
    "title": ParagraphStyle("title", fontName="Montserrat-Bold", fontSize=24, leading=29, textColor=NAVY, spaceAfter=6),
    "subtitle": ParagraphStyle("subtitle", fontName="Montserrat-Regular", fontSize=12.5, leading=17, textColor=BLUE, spaceAfter=14),
    "h2": ParagraphStyle("h2", fontName="Montserrat-SemiBold", fontSize=14, leading=18, textColor=NAVY, spaceBefore=14, spaceAfter=6),
    "body": ParagraphStyle("body", fontName="Montserrat-Regular", fontSize=10.5, leading=15.5, textColor=INK, spaceAfter=6),
    "cta_h": ParagraphStyle("cta_h", fontName="Montserrat-SemiBold", fontSize=13, leading=17, textColor=NAVY, spaceAfter=4),
    "cta": ParagraphStyle("cta", fontName="Montserrat-Regular", fontSize=10.5, leading=15, textColor=INK, spaceAfter=4),
    "cta_link": ParagraphStyle("cta_link", fontName="Montserrat-SemiBold", fontSize=11, leading=15, textColor=BLUE),
}


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def bullets(items, numbered):
    return ListFlowable([ListItem(Paragraph(esc(i), S["body"]), leftIndent=14) for i in items],
                        bulletType="1" if numbered else "bullet", start="1" if numbered else "•",
                        bulletFontName="Montserrat-SemiBold", bulletColor=BLUE, bulletFontSize=10.5, leftIndent=14)


def parse(text):
    """Returns (title, subtitle, flowables)."""
    title = subtitle = ""
    story, items, numbered = [], [], False

    def flush():
        nonlocal items
        if items:
            story.append(bullets(items, numbered))
            story.append(Spacer(1, 4))
            items = []

    for line in text.splitlines():
        s = line.strip()
        m = re.match(r"(\d+)\. (.*)", s)
        if s.startswith("- ") or m:
            is_num = bool(m)
            if items and is_num != numbered:
                flush()
            numbered = is_num
            items.append(m.group(2) if m else s[2:])
            continue
        flush()
        if not s:
            continue
        if s.startswith("## "):
            story.append(Paragraph(esc(s[3:]), S["h2"]))
        elif s.startswith("# "):
            title = s[2:]
        elif s.startswith("Subtitle:"):
            subtitle = s[len("Subtitle:"):].strip()
        elif s.startswith("CTA:"):
            heading, body, link = [p.strip() for p in s[4:].split("|")]
            box = Table([[Paragraph(esc(heading), S["cta_h"])], [Paragraph(esc(body), S["cta"])],
                         [Paragraph(f'<link href="https://{esc(link)}">{esc(link)}</link>', S["cta_link"])]],
                        colWidths=[6.5 * inch])
            box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PANEL), ("LINEBEFORE", (0, 0), (0, -1), 3, BLUE),
                                     ("LEFTPADDING", (0, 0), (-1, -1), 16), ("RIGHTPADDING", (0, 0), (-1, -1), 16),
                                     ("TOPPADDING", (0, 0), (-1, 0), 14), ("BOTTOMPADDING", (0, -1), (-1, -1), 14)]))
            story += [Spacer(1, 16), KeepTogether(box)]
        else:
            story.append(Paragraph(esc(s), S["body"]))
    flush()
    return title, subtitle, story


def page(canvas, doc):
    """Brand bar along the top (brand blue to cyan), wordmark, and a footer with the site address."""
    w, h = letter
    canvas.saveState()
    steps = 60
    for i in range(steps):
        t = i / (steps - 1)
        a, b = (BLUE, LIGHT_BLUE) if t < .5 else (LIGHT_BLUE, CYAN)
        u = t * 2 if t < .5 else (t - .5) * 2
        canvas.setFillColorRGB(*[x + (y - x) * u for x, y in zip(a.rgb(), b.rgb())])
        canvas.rect(w * i / steps, h - 8, w / steps + 1, 8, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont("Montserrat-SemiBold", 13)
    canvas.drawString(inch, h - .62 * inch, "Avello")
    canvas.setFont("Montserrat-Light", 13)
    canvas.drawString(inch + pdfmetrics.stringWidth("Avello ", "Montserrat-SemiBold", 13), h - .62 * inch, "Labs")
    canvas.setFont("Montserrat-Regular", 8.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(inch, .55 * inch, "avellolabs.com  ·  harris@avellolabs.com")
    canvas.drawRightString(w - inch, .55 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build(src, fonts):
    title, subtitle, story = parse(src.read_text(encoding="utf-8"))
    out = OUT / f"{src.stem}.pdf"
    doc = SimpleDocTemplate(str(out), pagesize=letter, leftMargin=inch, rightMargin=inch, topMargin=1.05 * inch,
                            bottomMargin=.9 * inch, title=title, author="Avello Labs", subject=subtitle)
    doc.build([Paragraph(esc(title), S["title"]), Paragraph(esc(subtitle), S["subtitle"])] + story,
              onFirstPage=page, onLaterPages=page)
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    fonts = Path(sys.argv[1])
    for weight in ("Light", "Regular", "SemiBold", "Bold"):
        pdfmetrics.registerFont(TTFont(f"Montserrat-{weight}", str(fonts / f"Montserrat-{weight}.ttf")))
    OUT.mkdir(exist_ok=True)
    for src in sorted(SRC.glob("*.txt")):
        print("built", build(src, fonts).relative_to(ROOT))


if __name__ == "__main__":
    main()
