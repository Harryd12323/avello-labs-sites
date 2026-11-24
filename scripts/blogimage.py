"""Pictures for blog posts: free Unsplash photos, saved to our own copy as small WebP files.

A post has one hero picture at the top (also its link preview image) and, on a longer post, maybe one more in
the text. The files live in assets/blog/<slug>/:

    hero-800.webp, hero-1600.webp   the hero, 16:9
    og.jpg                          the same picture at 1200x630, for link previews (og:image)
    inline-640.webp, inline-1280.webp   the picture in the text, 3:2

The post's head says which picture it has (sync builds the hero, og:image and the Article schema from these):

    <meta name="blog:image" content="/assets/blog/<slug>/hero">
    <meta name="blog:image-alt" content="What the picture shows">
    <meta name="blog:image-credit" content="Photographer|username|photo id">

Unsplash's licence lets anyone download and use a photo for free; a credit isn't required, but they ask for one,
so every picture carries "Photo by X on Unsplash", linked the way Unsplash asks. Only free photos (never
Unsplash+), never AI-generated ones.

Commands (scripts/site.py runs them, then sync):

    site.py post-image /blog/my-post/ https://unsplash.com/photos/<id> "Alt text" "Photographer" username
    site.py post-figure /blog/my-post/ https://unsplash.com/photos/<id> "Alt text" "Photographer" username "Heading it goes above"

Adding a picture needs Pillow (pip install pillow) and the network; nothing else in the site's scripts does.
"""
import html
import re
import shutil
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

PHOTO = re.compile(r"^(?:https://unsplash\.com/photos/)?(?:[a-z0-9-]+-)??([A-Za-z0-9_-]{11})$")
USERNAME = re.compile(r"^@?([A-Za-z0-9_]{1,60})$")
REFERRAL = "utm_source=avello_labs&amp;utm_medium=referral"      # Unsplash asks for these on links back to it
ALT = (20, 150)
HERO = ("hero", (16, 9), (800, 1600))
INLINE = ("inline", (3, 2), (640, 1280))
OG_SIZE = (1200, 630)
WEBP_QUALITY = 76
MAX_BYTES = 40_000_000
MIN_WIDTH = 1600


class ImageError(Exception):
    """A plain reason a picture couldn't be added."""


def photo_id(value):
    """The 11-character Unsplash photo ID from a photo page address (or the bare ID). '' if it isn't one."""
    m = PHOTO.match((value or "").strip().split("?")[0].rstrip("/"))
    return m.group(1) if m else ""


def username(value):
    m = USERNAME.match((value or "").strip())
    return m.group(1) if m else ""


def problems(photo, alt, name, user):
    """Why these details can't be a post's picture (an empty list: they can)."""
    out = []
    if not photo_id(photo):
        out.append("The picture must be an Unsplash photo page, like https://unsplash.com/photos/abc123DEF45.")
    if not ALT[0] <= len((alt or "").strip()) <= ALT[1]:
        out.append(f"The picture's alt text should say what it shows in {ALT[0]} to {ALT[1]} characters.")
    if not (name or "").strip() or "|" in (name or ""):
        out.append("The picture needs its photographer's name for the credit.")
    if not username(user):
        out.append("The picture needs the photographer's Unsplash username for the credit link.")
    return out


def credit_html(name, user):
    """"Photo by X on Unsplash", linked to the photographer and to Unsplash."""
    return (f'Photo by <a href="https://unsplash.com/@{html.escape(user)}?{REFERRAL}" rel="noopener">{html.escape(name)}</a> '
            f'on <a href="https://unsplash.com/?{REFERRAL}" rel="noopener">Unsplash</a>')


def download(pid, dest):
    """Save the photo from Unsplash's own download link (the one the Download button uses, so the photographer's
    download count goes up)."""
    req = urllib.request.Request(f"https://unsplash.com/photos/{pid}/download?force=true&w=2400",
                                 headers={"User-Agent": "avellolabs-site-build/1 (+https://avellolabs.com)",
                                          "Accept": "*/*"})        # Unsplash answers 401 without an Accept header
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            host = re.sub(r"^https://([^/]+)/.*$", r"\1", r.geturl())
            if host not in ("images.unsplash.com", "unsplash.com"):
                raise ImageError(f"Unsplash sent the download to {host}; not followed")
            data = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise ImageError(f"Unsplash answered HTTP {e.code} for photo {pid}") from None
    except OSError as e:
        raise ImageError(f"couldn't reach Unsplash ({type(e).__name__})") from None
    if len(data) > MAX_BYTES:
        raise ImageError("the photo is larger than expected")
    Path(dest).write_bytes(data)


def _fit(img, ratio, width, focus):
    from PIL import Image, ImageOps
    return ImageOps.fit(img, (width, round(width * ratio[1] / ratio[0])), Image.LANCZOS, centering=focus)


def build(source, out_dir, kind, focus=(0.5, 0.5)):
    """Write the WebP sizes (and og.jpg for a hero) from the downloaded photo. Returns the files written."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise ImageError("adding a picture needs Pillow (pip install pillow)") from None
    name, ratio, widths = kind
    try:
        img = ImageOps.exif_transpose(Image.open(source)).convert("RGB")
    except Exception as e:
        raise ImageError(f"the download isn't a picture ({type(e).__name__})") from None
    if img.width < MIN_WIDTH:
        raise ImageError(f"the photo is only {img.width}px wide; it needs {MIN_WIDTH}px or more")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for w in widths:
        f = out_dir / f"{name}-{w}.webp"
        _fit(img, ratio, w, focus).save(f, "WEBP", quality=WEBP_QUALITY, method=6)      # no EXIF or other metadata kept
        written.append(f)
    if kind is HERO:
        f = out_dir / "og.jpg"
        ImageOps.fit(img, OG_SIZE, Image.LANCZOS, centering=focus).save(f, "JPEG", quality=82, optimize=True, progressive=True)
        written.append(f)
    return written


def fetch_and_build(root, slug, photo, kind, focus=(0.5, 0.5)):
    pid = photo_id(photo)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "photo.jpg"
        download(pid, src)
        made = Path(tmp) / "out"
        build(src, made, kind, focus)                  # all sizes first, so a failure leaves nothing half-written
        out = Path(root) / "assets" / "blog" / slug
        out.mkdir(parents=True, exist_ok=True)
        for f in made.iterdir():
            shutil.copyfile(f, out / f.name)
    return pid


def picture_tag(base, kind, alt, lazy):
    name, ratio, widths = kind
    small, large = widths
    load = 'loading="lazy" decoding="async"' if lazy else 'fetchpriority="high" decoding="async"'
    return (f'<img src="{base}/{name}-{small}.webp" srcset="{base}/{name}-{small}.webp {small}w, {base}/{name}-{large}.webp {large}w" '
            f'sizes="(max-width: 46rem) 100vw, 44rem" width="{large}" height="{round(large * ratio[1] / ratio[0])}" '
            f'alt="{html.escape(alt)}" {load}>')


def figure(base, kind, alt, name, user, indent="        "):
    """The <figure> for a hero (loads first: it's at the top of the post) or an in-text picture (lazy-loaded)."""
    cls = "post-figure post-hero-img" if kind is HERO else "post-figure"
    return (f'{indent}<figure class="{cls}">\n{indent}  {picture_tag(base, kind, alt, lazy=kind is not HERO)}\n'
            f'{indent}  <figcaption>{credit_html(name, user)}</figcaption>\n{indent}</figure>')


def set_meta(text, name, value):
    """Add or replace a <meta name="..."> line in a post's head, just above the blog-head block."""
    line = f'<meta name="{name}" content="{html.escape(value)}">'
    text = re.sub(rf'<meta name="{re.escape(name)}" content="[^"]*">\n', "", text)
    return text.replace("<!-- shared:blog-head -->", line + "\n<!-- shared:blog-head -->", 1)


def add_hero(root, url, photo, alt, name, user, focus=(0.5, 0.5)):
    """Download the photo, write the hero files and record it in the post's head (sync then builds the rest)."""
    page, slug = _page(root, url)
    bad = problems(photo, alt, name, user)
    if bad:
        raise ImageError(" ".join(bad))
    pid = fetch_and_build(root, slug, photo, HERO, focus)
    text = page.read_text()
    text = set_meta(text, "blog:image", f"/assets/blog/{slug}/hero")
    text = set_meta(text, "blog:image-alt", alt.strip())
    text = set_meta(text, "blog:image-credit", f"{name.strip()}|{username(user)}|{pid}")
    page.write_text(text)


FIGURE = re.compile(r'[ \t]*<!-- post-figure -->.*?<!-- /post-figure -->\n', re.S)


def add_figure(root, url, photo, alt, name, user, heading, focus=(0.5, 0.5)):
    """Put one lazy-loaded picture in the post's text, just above the section whose heading is `heading`."""
    page, slug = _page(root, url)
    bad = problems(photo, alt, name, user)
    if bad:
        raise ImageError(" ".join(bad))
    text = FIGURE.sub("", page.read_text())
    m = next((m for m in re.finditer(r"\n([ \t]*)<h2[^>]*>(.*?)</h2>", text, re.S)
              if html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip().lower() == heading.strip().lower()), None)
    if not m:
        raise ImageError(f'the post has no section headed "{heading}"')
    fetch_and_build(root, slug, photo, INLINE, focus)
    ind = m.group(1)
    block = (f"\n{ind}<!-- post-figure -->\n" + figure(f"/assets/blog/{slug}", INLINE, alt.strip(), name.strip(), username(user), ind)
             + f"\n{ind}<!-- /post-figure -->")
    page.write_text(text[:m.start()] + block + text[m.start():])


def _page(root, url):
    m = re.fullmatch(r"/blog/([a-z0-9-]+)/", url)
    page = Path(root) / "blog" / (m.group(1) if m else "-") / "index.html"
    if not m or not page.exists():
        raise ImageError(f"No blog post at {url}")
    return page, m.group(1)
