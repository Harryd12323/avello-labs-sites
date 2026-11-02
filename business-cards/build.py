"""Build the Avello Labs business cards for Moo (US standard, 3.5 x 2 in).

Each side is a 3.75 x 2.25 in PDF (0.125 in bleed on every side) with CMYK
colours only, all artwork vector and all text outlined, plus a 300 DPI PNG
rendered from that PDF. Run with Python 3.12 and reportlab, pypdfium2,
fonttools, uharfbuzz and Pillow:

    python build.py <folder with Montserrat-{Light,Regular,SemiBold}.ttf>
"""
import math
import re
import sys
from pathlib import Path

import pypdfium2 as pdfium
import uharfbuzz as hb
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from reportlab.lib.colors import CMYKColor
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
BRAND = HERE.parent / "brand"
FONTS = Path(sys.argv[1])

IN = 72
TRIM_W, TRIM_H = 3.5 * IN, 2 * IN
BLEED = 0.125 * IN
SAFE = BLEED + 0.125 * IN  # text and logos stay inside this inset from the page edge
PAGE_W, PAGE_H = TRIM_W + 2 * BLEED, TRIM_H + 2 * BLEED
DPI = 300


def cmyk(c, m, y, k):
    return CMYKColor(c / 100, m / 100, y / 100, k / 100)


# Brand colours as print CMYK. Screen RGB blues and cyans sit outside the CMYK
# gamut, so these are the nearest clean builds rather than formula conversions.
NAVY_BG = cmyk(75, 60, 0, 90)     # #070A19 site background, rich navy (225% ink)
NAVY_INK = cmyk(85, 70, 0, 80)    # #0A1022 wordmark navy, for text on white
BLUE = cmyk(72, 52, 0, 0)         # #4D74F2
LIGHT_BLUE = cmyk(58, 22, 0, 0)   # #62AFF9
CYAN = cmyk(70, 0, 10, 0)         # #22D3EE
WHITE = cmyk(0, 0, 0, 0)
GREY = cmyk(55, 42, 0, 50)        # muted navy for secondary text
GRADIENT = [BLUE, LIGHT_BLUE, CYAN]
STOPS = [0, 0.5, 1]


# ---------- SVG path parsing (M L H V Q C A Z, absolute, as build.py writes them) ----------
def svg_subpaths(d):
    """Return a list of subpaths; each is a list of ("M"|"L"|"C", points) and "Z"."""
    toks = re.findall(r"[MLHVQCAZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    out, cur, i, cmd = [], None, 0, None
    x = y = sx = sy = 0.0

    def num():
        nonlocal i
        i += 1
        return float(toks[i - 1])

    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]
            i += 1
        if cmd == "M":
            x, y = num(), num()
            sx, sy = x, y
            cur = [("M", [(x, y)])]
            out.append(cur)
            cmd = "L"
        elif cmd == "L":
            x, y = num(), num()
            cur.append(("L", [(x, y)]))
        elif cmd == "H":
            x = num()
            cur.append(("L", [(x, y)]))
        elif cmd == "V":
            y = num()
            cur.append(("L", [(x, y)]))
        elif cmd == "Q":
            qx, qy, ex, ey = num(), num(), num(), num()
            cur.append(("C", [(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y)),
                              (ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey)), (ex, ey)]))
            x, y = ex, ey
        elif cmd == "C":
            pts = [(num(), num()) for _ in range(3)]
            cur.append(("C", pts))
            x, y = pts[-1]
        elif cmd == "A":
            rx, _ry, _rot, large, sweep, ex, ey = (num() for _ in range(7))
            cur.append(("A", [(x, y), (ex, ey), (rx, large, sweep)]))
            x, y = ex, ey
        elif cmd == "Z":
            cur.append(("Z", []))
            x, y = sx, sy
            cmd = None
    return out


def arc_center(p0, p1, r, large, sweep):
    """Centre of a circular SVG arc (rx == ry, no rotation) and its start/end angles."""
    (x0, y0), (x1, y1) = p0, p1
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = (x1 - x0) / 2, (y1 - y0) / 2
    half = math.hypot(dx, dy)
    h = math.sqrt(max(r * r - half * half, 0))
    sign = -1 if large == sweep else 1
    cx, cy = mx + sign * h * (-dy) / half, my + sign * h * dx / half
    a0 = math.atan2(y0 - cy, x0 - cx)
    a1 = math.atan2(y1 - cy, x1 - cx)
    if sweep and a1 < a0:
        a1 += 2 * math.pi
    if not sweep and a1 > a0:
        a1 -= 2 * math.pi
    return cx, cy, a0, a1


class Placer:
    """Maps SVG user units (y down) onto the PDF page (y up)."""

    def __init__(self, x, y, scale):
        self.x, self.y, self.s = x, y, scale

    def __call__(self, px, py):
        return self.x + px * self.s, self.y - py * self.s


def add_arc(path, cx, cy, r, a0, a1, place, first):
    """Append a circular arc (SVG coords, angles in radians) as cubic segments."""
    n = max(1, math.ceil(abs(a1 - a0) / (math.pi / 4)))
    step = (a1 - a0) / n
    k = 4 / 3 * math.tan(step / 4)
    for j in range(n):
        t0, t1 = a0 + j * step, a0 + (j + 1) * step
        p0 = (cx + r * math.cos(t0), cy + r * math.sin(t0))
        p3 = (cx + r * math.cos(t1), cy + r * math.sin(t1))
        c1 = (p0[0] - k * r * math.sin(t0), p0[1] + k * r * math.cos(t0))
        c2 = (p3[0] + k * r * math.sin(t1), p3[1] - k * r * math.cos(t1))
        if first and j == 0:
            path.moveTo(*place(*p0))
        elif j == 0:
            path.lineTo(*place(*p0))
        path.curveTo(*place(*c1), *place(*c2), *place(*p3))


def fill_svg_path(c, d, place, colour):
    p = c.beginPath()
    for sub in svg_subpaths(d):
        for op, pts in sub:
            if op == "M":
                p.moveTo(*place(*pts[0]))
            elif op == "L":
                p.lineTo(*place(*pts[0]))
            elif op == "C":
                p.curveTo(*(v for pt in pts for v in place(*pt)))
            elif op == "Z":
                p.close()
    c.setFillColor(colour)
    c.drawPath(p, stroke=0, fill=1, fillMode=1)  # nonzero, as in the SVG


def gradient_fill(c, clip, place, x1, y1, x2, y2):
    """Fill the clip path with the brand gradient along the SVG axis (x1,y1)->(x2,y2)."""
    c.saveState()
    c.clipPath(clip, stroke=0, fill=0, fillMode=1)
    c.linearGradient(*place(x1, y1), *place(x2, y2), GRADIENT, STOPS, extend=True)
    c.restoreState()


def svg_gradient_axis(svg):
    m = re.search(r'x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"', svg)
    return [float(v) for v in m.groups()]


# ---------- logos ----------
def draw_ring_logo(c, cx, cy, width):
    """brand/logo-ring.svg, centred on (cx, cy), `width` points wide."""
    svg = (BRAND / "logo-ring.svg").read_text()
    vw, vh = (float(v) for v in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg).groups())
    s = width / vw
    place = Placer(cx - width / 2, cy + vh * s / 2, s)
    paths = re.findall(r'<path ([^>]*)d="([^"]+)"', svg)

    # The ring: a gradient stroke with round caps. PDF can't stroke with a
    # gradient, so outline the stroke (annular sector plus caps) and clip to it.
    attrs, ring_d = paths[0]
    half = float(re.search(r'stroke-width="([\d.]+)"', attrs).group(1)) / 2
    clip = c.beginPath()
    for sub in svg_subpaths(ring_d):
        p0, p1, (r, large, sweep) = sub[1][1]
        ax, ay, a0, a1 = arc_center(p0, p1, r, int(large), int(sweep))
        add_arc(clip, ax, ay, r + half, a0, a1, place, first=True)
        ex, ey = ax + r * math.cos(a1), ay + r * math.sin(a1)
        add_arc(clip, ex, ey, half, a1, a1 + math.pi, place, first=False)   # end cap
        add_arc(clip, ax, ay, r - half, a1, a0, place, first=False)
        sx, sy = ax + r * math.cos(a0), ay + r * math.sin(a0)
        add_arc(clip, sx, sy, half, a0 + math.pi, a0 + 2 * math.pi, place, first=False)  # start cap
        clip.close()
    gradient_fill(c, clip, place, *svg_gradient_axis(svg))

    for _attrs, d in paths[1:]:
        fill_svg_path(c, d, place, WHITE)


def draw_icon(c, x, y, size):
    """brand/icon.svg with its top-left corner at (x, y), `size` points square."""
    svg = (BRAND / "icon.svg").read_text()
    place = Placer(x, y, size / 64)
    half = float(re.search(r'stroke-width="([\d.]+)"', svg).group(1)) / 2
    # Each bar is filled and stroked with round joins: that is the polygon grown
    # by half the stroke width with rounded corners (both bars are convex).
    clip = c.beginPath()
    for d in re.findall(r'<path d="([^"]+)"', svg):
        pts = [pt[0] for op, pt in svg_subpaths(d)[0] if op in "ML"]
        area = sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))
        ccw = 1 if area < 0 else -1  # orientation in y-down coords

        def normal(a, b):
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            return math.atan2(-dx * ccw / ln, dy * ccw / ln)

        n = len(pts)
        for i, v in enumerate(pts):
            ain = normal(pts[i - 1], v)
            aout = normal(v, pts[(i + 1) % n])
            while aout < ain:
                aout += 2 * math.pi
            if aout - ain > math.pi:
                aout -= 2 * math.pi
            add_arc(clip, v[0], v[1], half, ain, aout, place, first=(i == 0))
        clip.close()
    gradient_fill(c, clip, place, *svg_gradient_axis(svg))


# ---------- outlined text ----------
class RLPen(BasePen):
    def __init__(self, glyphset, path, x, y, s):
        super().__init__(glyphset)
        self.p, self.x, self.y, self.s = path, x, y, s

    def t(self, pt):
        return self.x + pt[0] * self.s, self.y + pt[1] * self.s

    def _moveTo(self, pt):
        self.p.moveTo(*self.t(pt))

    def _lineTo(self, pt):
        self.p.lineTo(*self.t(pt))

    def _curveToOne(self, p1, p2, p3):
        self.p.curveTo(*self.t(p1), *self.t(p2), *self.t(p3))

    def _closePath(self):
        self.p.close()


class Font:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.hb = hb.Font(hb.Face(Path(path).read_bytes()))
        self.upm = self.tt["head"].unitsPerEm

    def shape(self, text, tracking=0):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, {"kern": True, "liga": True})
        order = self.tt.getGlyphOrder()
        return [(order[i.codepoint], p.x_advance + tracking * self.upm)
                for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

    def width(self, text, size, tracking=0):
        return sum(a for _, a in self.shape(text, tracking)) * size / self.upm - tracking * size

    def draw(self, c, text, x, baseline, size, colour, tracking=0):
        gs = self.tt.getGlyphSet()
        s = size / self.upm
        p = c.beginPath()
        cx = x
        for gname, adv in self.shape(text, tracking):
            gs[gname].draw(RLPen(gs, p, cx, baseline, s))
            cx += adv * s
        c.setFillColor(colour)
        c.drawPath(p, stroke=0, fill=1, fillMode=1)
        return x + self.width(text, size, tracking)


LIGHT = Font(FONTS / "Montserrat-Light.ttf")
REGULAR = Font(FONTS / "Montserrat-Regular.ttf")
SEMI = Font(FONTS / "Montserrat-SemiBold.ttf")


# ---------- the two sides ----------
class Card(canvas.Canvas):
    def _make_preamble(self):
        # All text is outlined, so skip reportlab's default Helvetica text state:
        # an unembedded font reference would fail a printer's preflight.
        self._preamble = "1 0 0 1 0 0 cm"


def new_page(name):
    c = Card(str(HERE / f"{name}.pdf"), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle(f"Avello Labs business card, {name}")
    c.setAuthor("Avello Labs")
    # TrimBox and BleedBox tell the printer where the cut goes.
    c.setTrimBox((BLEED, BLEED, PAGE_W - BLEED, PAGE_H - BLEED))
    c.setBleedBox((0, 0, PAGE_W, PAGE_H))
    return c


def front():
    c = new_page("front")
    c.setFillColor(NAVY_BG)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    draw_ring_logo(c, PAGE_W / 2, PAGE_H / 2, 2.05 * IN)
    c.showPage()
    c.save()


def back():
    c = new_page("back")
    c.setFillColor(WHITE)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    left, right = SAFE, PAGE_W - SAFE

    # One stack (name block, rule, contact lines), centred vertically on the
    # card. Its height runs from the name's cap height to the last baseline.
    name_cap = 14 * SEMI.tt["OS/2"].sCapHeight / SEMI.upm
    size, lead = 8.5, 13.5
    stack = name_cap + 15 + 12 + 13 + 20 + 2 * lead
    top = BLEED + (TRIM_H + stack) / 2
    assert top <= PAGE_H - SAFE and top - stack >= SAFE, "stack leaves the safe zone"

    # Mark in the top right, level with the top of the name.
    icon = 0.42 * IN
    draw_icon(c, right - icon, top, icon)

    # Name block.
    y = top - name_cap
    SEMI.draw(c, "Harris Ravelli", left, y, 14, NAVY_INK)
    y -= 15
    LIGHT.draw(c, "Owner", left, y, 9, GREY)
    y -= 12
    REGULAR.draw(c, "Avello Labs LLC", left, y, 9, GREY)

    # Brand gradient rule.
    rule_y = y - 13
    rule = c.beginPath()
    rule.roundRect(left, rule_y, 0.9 * IN, 2.2, 1.1)
    c.saveState()
    c.clipPath(rule, stroke=0, fill=0)
    c.linearGradient(left, rule_y, left + 0.9 * IN, rule_y, GRADIENT, STOPS, extend=True)
    c.restoreState()

    # Contact lines just under the rule, each with a small gradient tick.
    lines = ["856-470-6300", "harris@avellolabs.com", "avellolabs.com"]
    for j, text in enumerate(lines):
        base = rule_y - 20 - j * lead
        colour = [BLUE, LIGHT_BLUE, CYAN][j]
        c.setFillColor(colour)
        c.roundRect(left, base + 1.3, 6, 3.2, 1.6, stroke=0, fill=1)
        REGULAR.draw(c, text, left + 12, base, size, NAVY_INK)

    c.showPage()
    c.save()


def png(name):
    pdf = pdfium.PdfDocument(str(HERE / f"{name}.pdf"))
    img = pdf[0].render(scale=DPI / 72).to_pil().convert("RGB")
    assert img.size == (round(PAGE_W / 72 * DPI), round(PAGE_H / 72 * DPI)), img.size
    img.save(HERE / f"{name}.png", dpi=(DPI, DPI))


if __name__ == "__main__":
    front()
    back()
    png("front")
    png("back")
    print("built", ", ".join(f"{n}.pdf/.png" for n in ("front", "back")))
