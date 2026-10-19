"""Generate the Avello Labs brand SVGs. Run with the scratch venv:
    venv/bin/python -I build.py <fonts_dir> <out_dir>
"""
import math
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONTS = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

# Colors (sampled from the reference images, then rounded to a tidy palette)
ICON_STOPS = [(0, "#62AFF9"), (0.5, "#4D74F2"), (1, "#2F24BC")]
RING_STOPS = [(0, "#56A2F1"), (0.5, "#3C63EE"), (1, "#4A2ADC")]
WHITE = "#FFFFFF"
INK = "#0A1022"  # dark navy: favicon tile and wordmark on light backgrounds

# ---------- fonts ----------
VF = FONTS / "Montserrat-VF.ttf"
fonts = {}
for name, wght in (("bold", 600), ("light", 300)):
    path = FONTS / f"Montserrat-{wght}.ttf"
    if not path.exists():
        instancer.instantiateVariableFont(TTFont(VF), {"wght": wght}).save(path)
    data = path.read_bytes()
    face = hb.Face(data)
    fonts[name] = (TTFont(path), hb.Font(face))


def shape(name, text):
    tt, hbfont = fonts[name]
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    order = tt.getGlyphOrder()
    return [(order[i.codepoint], p.x_advance) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def run_width(name, text, size):
    upm = fonts[name][0]["head"].unitsPerEm
    return sum(adv for _, adv in shape(name, text)) * size / upm


def text_path(name, text, size, x, baseline):
    """Outline `text` as one SVG path string, origin at (x, baseline)."""
    tt, _ = fonts[name]
    gs = tt.getGlyphSet()
    s = size / tt["head"].unitsPerEm
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    cx = 0
    for gname, adv in shape(name, text):
        gs[gname].draw(TransformPen(pen, (s, 0, 0, -s, x + cx * s, baseline)))
        cx += adv
    return pen.getCommands()


def cap_height(name):
    return fonts[name][0]["OS/2"].sCapHeight / fonts[name][0]["head"].unitsPerEm


# ---------- the mark ----------
# 64x64 grid. Both bars lean at the same angle (tan = 0.36, about 20 degrees off
# vertical) and sit on one flat baseline. The left bar is cut parallel to the right
# bar's inner edge, leaving an even gap, so the two read as an "A" without touching.
T = 0.36           # horizontal run per unit of height
BASE, TOP = 58, 6  # baseline and apex of the tall bar
W = 17             # horizontal width of each bar
GAP = 6            # horizontal gap between the bars
R_X0 = 59 - W      # right bar, bottom-left x
L_X0 = 5           # left bar, bottom-left x


def mark_polys():
    h = BASE - TOP
    right = [(R_X0 - T * h, TOP), (R_X0 - T * h + W, TOP), (R_X0 + W, BASE), (R_X0, BASE)]

    # Inner edge of the right bar, shifted left by GAP: x = c + T*y
    c = (R_X0 - T * h) - T * TOP - GAP

    def meet(x0):  # where a "/" edge from (x0, BASE) meets that cut line
        y = (x0 + T * BASE - c) / (2 * T)
        return (x0 + T * (BASE - y), y)

    left = [(L_X0, BASE), (L_X0 + W, BASE), meet(L_X0 + W), meet(L_X0)]
    return left, right


def poly_d(pts, dx=0.0, dy=0.0, k=1.0):
    return "M" + " L".join(f"{dx + x * k:.2f} {dy + y * k:.2f}" for x, y in pts) + " Z"


def gradient(gid, stops, x1, y1, x2, y2):
    s = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" '
            f'x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}">{s}</linearGradient>')


def mark(gid, dx=0.0, dy=0.0, k=1.0):
    """The two bars, with corners softened by a matching round-joined stroke."""
    left, right = mark_polys()
    grad = gradient(gid, ICON_STOPS, dx + 4 * k, dy + 14 * k, dx + 60 * k, dy + 60 * k)
    sw = 3.2 * k
    body = (f'<g fill="url(#{gid})" stroke="url(#{gid})" stroke-width="{sw:.2f}" stroke-linejoin="round">'
            f'<path d="{poly_d(left, dx, dy, k)}"/><path d="{poly_d(right, dx, dy, k)}"/></g>')
    return grad, body


def svg(w, h, title, defs, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" '
            f'width="{w:g}" height="{h:g}" role="img" aria-label="{title}">\n'
            f'<title>{title}</title>\n<defs>{defs}</defs>\n{body}\n</svg>\n')


def write(name, content):
    (OUT / name).write_text(content)
    print("wrote", OUT / name)


# 1. icon.svg
g, b = mark("av-icon")
write("icon.svg", svg(64, 64, "Avello Labs", g, b))

# 4. favicon.svg
g, b = mark("av-fav", dx=8, dy=7.5, k=0.75)
write("favicon.svg", svg(64, 64, "Avello Labs",
                         g, f'<rect width="64" height="64" rx="14" fill="{INK}"/>\n{b}'))


# Wordmark: "Λvello" (Montserrat SemiBold, Greek capital lambda for the open A) + "Labs" (Light)
def wordmark(size, x, baseline, fill, fill_labs=None):
    space = run_width("bold", " ", size) * 0.9
    w1 = run_width("bold", "Λvello", size)
    w2 = run_width("light", "Labs", size)
    d1 = text_path("bold", "Λvello", size, x, baseline)
    d2 = text_path("light", "Labs", size, x + w1 + space, baseline)
    body = (f'<path fill="{fill}" d="{d1}"/>\n'
            f'<path fill="{fill_labs or fill}" d="{d2}"/>')
    return body, w1 + space + w2


# 2. logo-ring.svg
SIZE = 80
probe, tw = wordmark(SIZE, 0, 0, WHITE)
R = 150
SW = 5
pad = 12
W_ = max(tw, 2 * R + SW) + 2 * pad
H_ = 2 * R + SW + 2 * pad
cx, cy = W_ / 2, H_ / 2
baseline = cy + cap_height("bold") * SIZE / 2
text_body, _ = wordmark(SIZE, cx - tw / 2, baseline, WHITE)


def arc(a0, a1):
    """Arc on the ring from angle a0 to a1 (degrees, counter-clockwise from 3 o'clock, y up)."""
    p = lambda a: (cx + R * math.cos(math.radians(a)), cy - R * math.sin(math.radians(a)))
    (x0, y0), (x1, y1) = p(a0), p(a1)
    large = 1 if (a0 - a1) % 360 > 180 else 0
    return f"M{x0:.2f} {y0:.2f} A{R} {R} 0 {large} 1 {x1:.2f} {y1:.2f}"


ring_grad = gradient("av-ring", RING_STOPS, cx - R, cy - R * 0.4, cx + R, cy + R * 0.4)
ring = (f'<path fill="none" stroke="url(#av-ring)" stroke-width="{SW}" stroke-linecap="round" '
        f'd="{arc(158, 22)} {arc(318, 204)}"/>')
write("logo-ring.svg", svg(round(W_), round(H_), "Avello Labs", ring_grad, ring + "\n" + text_body))

# 3. logo-horizontal (dark + light backgrounds)
ICON_K = 1.0     # icon drawn at 64 units tall
HSIZE = 44       # wordmark size; cap height ~ 31 units, about half the icon
gap = 18
hb_, hw = wordmark(HSIZE, 0, 0, WHITE)
HW = 64 + gap + hw + 4
HH = 64
hbase = 32 + cap_height("bold") * HSIZE / 2 + 2  # optically centre caps on the mark (2 = bar baseline offset)
for variant, ink in (("dark", WHITE), ("light", INK)):
    g, b = mark(f"av-h-{variant}")
    t, _ = wordmark(HSIZE, 64 + gap, hbase, ink)
    write(f"logo-horizontal-{variant}.svg", svg(round(HW), HH, "Avello Labs", g, b + "\n" + t))
