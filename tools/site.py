#!/usr/bin/env python3
"""Keep the shared parts of every Avello Labs page in sync, and start new pages.

Each page is plain, hand-edited HTML. The parts every page shares sit between marker comments:

    <!-- shared:head -->   ... <!-- /shared:head -->     robots/noindex, security policy, favicon, fonts, CSS
    <!-- shared:header --> ... <!-- /shared:header -->   skip link and site header/nav
    <!-- shared:footer --> ... <!-- /shared:footer -->   footer and the site script

Commands (run from the repo root, Python 3 only, nothing to install):

    python3 tools/site.py sync
        Rewrites the shared blocks on every page from the templates below, marks the current
        page in the nav, and rebuilds sitemap.xml.

    python3 tools/site.py new /blog/my-first-post/ "Page title | Avello Labs" "Meta description"
        Creates blog/my-first-post/index.html with the shared blocks and an empty article to fill in,
        then runs sync.

Everything outside the markers (titles, meta descriptions, og tags, JSON-LD, page content) is
never touched.
"""
import html
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://avellolabs.com"
EMAIL = "harris@avellolabs.com"

# Preview mode: every page carries noindex. Set to False and run `sync` to go live.
NOINDEX = False

# Folders that aren't part of the site's pages.
SKIP = {"concepts", "brand", "work", "assets", "tools", ".git"}

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src https://api.web3forms.com; "
       "form-action https://api.web3forms.com; base-uri 'self'; object-src 'none'")

NAV = [("/seo/", "SEO"), ("/aeo/", "AEO"), ("/website-care/", "Website care"), ("/web-apps/", "Web apps"),
       ("/#work", "Concept work")]


def shared_head():
    robots = ('<!-- Preview only: keeps search engines out. Set NOINDEX = False in tools/site.py and run sync to go live. -->\n'
              '<meta name="robots" content="noindex, nofollow">\n') if NOINDEX else ""
    return f"""<!-- shared:head -->
{robots}<meta http-equiv="Content-Security-Policy" content="{CSP}">
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/assets/site.css">
<!-- /shared:head -->"""


def shared_header(current):
    links = "\n".join(
        f'      <a class="nav-link" href="{h}"{" aria-current=\"page\"" if current.startswith(h) and h != "/#work" else ""}>{l}</a>'
        for h, l in NAV)
    return f"""<!-- shared:header -->
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Avello Labs, home">
      <img src="/brand/logo-horizontal-dark.svg" width="337" height="64" alt="Avello Labs">
    </a>
    <button class="menu-btn" id="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">
      <svg class="bars" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      <svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <nav class="site-nav" id="site-nav" aria-label="Main">
{links}
      <a class="btn btn-small" href="/#contact">Get in touch</a>
    </nav>
  </div>
</header>
<!-- /shared:header -->"""


def shared_footer():
    return f"""<!-- shared:footer -->
<footer class="site">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <img src="/brand/logo-horizontal-dark.svg" width="337" height="64" alt="Avello Labs">
        <p>Fast websites, ongoing site care, SEO and AEO for small local businesses.</p>
      </div>
      <div>
        <h2>Services</h2>
        <ul>
          <li><a href="/seo/">SEO</a></li>
          <li><a href="/aeo/">AEO</a></li>
          <li><a href="/website-care/">Website care</a></li>
          <li><a href="/web-apps/">Web apps</a></li>
        </ul>
      </div>
      <div>
        <h2>Company</h2>
        <ul>
          <li><a href="/#work">Concept work</a></li>
          <li><a href="/#contact">Contact</a></li>
          <li><a href="/privacy/">Privacy policy</a></li>
          <li><a href="/terms/">Terms of use</a></li>
        </ul>
      </div>
      <div>
        <h2>Contact</h2>
        <address>
          <a href="mailto:{EMAIL}">{EMAIL}</a><br>
          Avello Labs LLC<br>
          PO Box 141<br>
          Collingswood, NJ 08108-9998
        </address>
      </div>
    </div>
    <div class="foot-bottom">
      <span>© <span data-year>{date.today().year}</span> Avello Labs LLC. All rights reserved.</span>
      <span><a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></span>
    </div>
  </div>
</footer>

<script src="/assets/site.js" defer></script>
<!-- /shared:footer -->"""


def pages():
    """Every index.html that belongs to the site, with its URL path."""
    found = []
    for f in sorted(ROOT.rglob("index.html")):
        rel = f.relative_to(ROOT)
        if rel.parts[0] in SKIP:
            continue
        url = "/" + "/".join(rel.parts[:-1]) + ("/" if len(rel.parts) > 1 else "")
        found.append((url, f))
    return found


def replace_block(text, name, new, path):
    pattern = re.compile(rf"<!-- shared:{name} -->.*?<!-- /shared:{name} -->", re.S)
    if not pattern.search(text):
        sys.exit(f"{path}: missing <!-- shared:{name} --> markers")
    return pattern.sub(lambda _: new, text, count=1)


def sync():
    found = pages()
    for url, f in found:
        text = f.read_text()
        text = replace_block(text, "head", shared_head(), f)
        text = replace_block(text, "header", shared_header(url), f)
        text = replace_block(text, "footer", shared_footer(), f)
        f.write_text(text)
        print("synced", url)
    rows = "".join(f"  <url><loc>{SITE}{url}</loc><lastmod>{date.fromtimestamp(f.stat().st_mtime).isoformat()}</lastmod></url>\n"
                   for url, f in found)
    (ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
                                      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + "</urlset>\n")
    print(f"sitemap.xml: {len(found)} pages")


def new(url, title, desc):
    if not (url.startswith("/") and url.endswith("/")):
        sys.exit("The page path must start and end with a slash, like /blog/my-post/")
    out = ROOT / url.strip("/") / "index.html"
    if out.exists():
        sys.exit(f"{out} already exists")
    t, d = html.escape(title), html.escape(desc)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{shared_head()}
<title>{t}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{SITE}{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Avello Labs">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{SITE}{url}">
<meta name="twitter:card" content="summary">
</head>
<body>
{shared_header(url)}

<main id="main">
  <section class="page-hero">
    <div class="wrap">
      <p class="crumbs"><a href="/">Home</a> / TODO section name</p>
      <h1>TODO headline</h1>
      <p class="lede">TODO one or two sentences that sum up the page.</p>
    </div>
  </section>
  <div class="page-body">
    <div class="wrap">
      <article class="prose">
        <h2>TODO first heading</h2>
        <p>TODO</p>
      </article>
    </div>
  </div>
</main>

{shared_footer()}
</body>
</html>
""")
    print("created", out)
    sync()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "sync":
        sync()
    elif len(sys.argv) == 5 and sys.argv[1] == "new":
        new(*sys.argv[2:])
    else:
        sys.exit(__doc__)
