#!/usr/bin/env python3
"""Keep the shared parts of every Avello Labs page in sync, and start new pages.

Each page is plain, hand-edited HTML. The parts every page shares sit between marker comments:

    <!-- shared:head -->   ... <!-- /shared:head -->     robots/noindex, security policy, favicon, fonts, CSS
    <!-- shared:header --> ... <!-- /shared:header -->   skip link and site header/nav
    <!-- shared:footer --> ... <!-- /shared:footer -->   footer and the site script

Commands (run from the repo root, Python 3 only, nothing to install):

    python3 scripts/site.py sync
        Rewrites the shared blocks on every page from the templates below, marks the current
        page in the nav, rebuilds sitemap.xml, and refreshes worker/knowledge.txt (the site text
        the chat assistant answers from).

    python3 scripts/site.py new /blog/my-first-post/ "Page title | Avello Labs" "Meta description"
        Creates blog/my-first-post/index.html with the shared blocks and an empty article to fill in,
        then runs sync.

Everything outside the markers (titles, meta descriptions, og tags, JSON-LD, page content) is
never touched.
"""
import html
import re
from html.parser import HTMLParser
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://avellolabs.com"
EMAIL = "harris@avellolabs.com"

# Preview mode: every page carries noindex. Set to False and run `sync` to go live.
NOINDEX = False

# Folders that aren't part of the site's pages.
SKIP = {"concepts", "brand", "work", "assets", "scripts", "worker", "check-worker", "alerts-worker", "workers-shared", ".git"}

# Chat assistant (see worker/). CHAT_ENDPOINT is the deployed Worker's /chat URL; leave it empty to hide
# the chat. CHAT_DEV_ENDPOINT is used only when the site is opened on localhost, for testing. Set it to
# None before publishing so the security policy doesn't list it.
CHAT_ENDPOINT = "https://avello-chat.avellolabs.workers.dev/chat"
CHAT_DEV_ENDPOINT = None
# Free tools backend (see check-worker/): /check, /preview, /crawlers and /ticket/newsletter. Each tool page
# gets its script from a page-specific block (TOOL_BLOCKS below), which sync fills in from here.
CHECK_BASE = "https://avello-check.avellolabs.workers.dev"
CHECK_ENDPOINT = f"{CHECK_BASE}/check"
# Lead alerts (see alerts-worker/): after a lead is emailed, the browser also posts it here for a Telegram alert.
ALERTS_ENDPOINT = "https://avello-alerts.avellolabs.workers.dev/lead"
# Public by design: Web3Forms access keys only let messages be sent to the key owner's inbox.
WEB3FORMS_KEY = "a6955225-5ff5-4562-ae2d-dfda9193580a"

# Pages whose text the chat assistant answers from.
KNOWLEDGE_PAGES = ["/", "/seo/", "/aeo/", "/website-care/", "/web-apps/", "/tools/"]


def origin(url):
    return re.match(r"^https?://[^/]+", url).group(0) if url else ""

CONNECT = " ".join(o for o in ["https://api.web3forms.com", origin(CHAT_ENDPOINT), origin(CHAT_DEV_ENDPOINT or ""), origin(CHECK_ENDPOINT), origin(ALERTS_ENDPOINT)] if o)
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
       f"font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src {CONNECT}; "
       "form-action https://api.web3forms.com; base-uri 'self'; object-src 'none'")

NAV = [("/seo/", "SEO"), ("/aeo/", "AEO"), ("/website-care/", "Website care"), ("/web-apps/", "Web apps"),
       ("/#work", "Concept work"), ("/tools/", "Free tools")]

# Pages that count as part of a nav item, besides the ones under its own path.
NAV_ALSO = {"/tools/": ["/check/"]}


def shared_head():
    robots = ('<!-- Preview only: keeps search engines out. Set NOINDEX = False in scripts/site.py and run sync to go live. -->\n'
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
        f'      <a class="nav-link" href="{h}"{" aria-current=\"page\"" if (current.startswith(h) or current in NAV_ALSO.get(h, [])) and h != "/#work" else ""}>{l}</a>'
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
        <h2>Free tools</h2>
        <ul>
          <li><a href="/check/">Free site check</a></li>
          <li><a href="/tools/search-preview/">Search preview</a></li>
          <li><a href="/tools/ai-crawler-check/">AI crawler check</a></li>
          <li><a href="/tools/schema-generator/">Schema generator</a></li>
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
    {newsletter_form("foot")}
    <div class="foot-bottom">
      <span>© <span data-year>{date.today().year}</span> Avello Labs LLC. All rights reserved.</span>
      <span><a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></span>
    </div>
  </div>
</footer>

<script src="/assets/site.js" defer></script>
<script src="/assets/newsletter.js" data-ticket="{CHECK_BASE}/ticket/newsletter" data-alerts="{ALERTS_ENDPOINT}" data-web3forms="{WEB3FORMS_KEY}" defer></script>
{chat_script()}
<!-- /shared:footer -->"""


NEWSLETTER_CONSENT = ("Send me the Avello Labs newsletter: practical website and search tips for small businesses, "
                      "about once a month. Unsubscribe anytime by replying \"unsubscribe\" or emailing harris@avellolabs.com.")


def newsletter_form(prefix, heading_tag="h2"):
    """The newsletter signup box. `prefix` keeps element ids unique when a page has more than one box."""
    return f"""<form class="nl-form" novalidate aria-labelledby="{prefix}-nl-h">
      <{heading_tag} class="nl-title" id="{prefix}-nl-h">Website tips, about once a month</{heading_tag}>
      <p class="nl-sub">Practical website and search tips for small businesses. No spam.</p>
      <div class="hp" aria-hidden="true"><label for="{prefix}-nl-bot">Leave this box unticked</label><input type="checkbox" id="{prefix}-nl-bot" name="botcheck" tabindex="-1" autocomplete="off"></div>
      <div class="nl-fields">
        <div class="field"><label for="{prefix}-nl-name">Name <small>(optional)</small></label><input id="{prefix}-nl-name" name="name" autocomplete="name" maxlength="80"></div>
        <div class="field"><label for="{prefix}-nl-email">Email</label><input id="{prefix}-nl-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" required></div>
        <button class="btn" type="submit">Sign up</button>
      </div>
      <label class="nl-consent"><input type="checkbox" name="consent" required> <span>{html.escape(NEWSLETTER_CONSENT)}</span></label>
      <p class="form-status" role="status" aria-live="polite"></p>
      <p class="nl-note">We only use your email for the newsletter. See our <a href="/privacy/#newsletter">privacy policy</a>.</p>
    </form>"""


# Page-specific tool scripts. A page opts in with <!-- shared:NAME --> ... <!-- /shared:NAME --> markers.
TOOL_BLOCKS = {
    "check": ("/assets/check.css", "/assets/check.js", f'data-endpoint="{CHECK_ENDPOINT}" data-web3forms="{WEB3FORMS_KEY}" data-alerts="{ALERTS_ENDPOINT}"'),
    "tool-hub": ("/assets/tools.css", None, ""),
    "tool-preview": ("/assets/tools.css", "/assets/preview.js", f'data-endpoint="{CHECK_BASE}/preview"'),
    "tool-crawlers": ("/assets/tools.css", "/assets/crawlers.js", f'data-endpoint="{CHECK_BASE}/crawlers"'),
    "tool-schema": ("/assets/tools.css", "/assets/schema-gen.js", ""),
}


def tool_block(name):
    css, js, attrs = TOOL_BLOCKS[name]
    lines = [f"<!-- shared:{name} -->", f'<link rel="stylesheet" href="{css}">']
    if js:
        lines.append(f'<script src="{js}" {attrs} defer></script>'.replace("  ", " "))
    lines.append(f"<!-- /shared:{name} -->")
    return "\n".join(lines)


def chat_script():
    if not (CHAT_ENDPOINT or CHAT_DEV_ENDPOINT):
        return ""
    dev = f' data-dev-endpoint="{CHAT_DEV_ENDPOINT}"' if CHAT_DEV_ENDPOINT else ""
    return (f'<link rel="stylesheet" href="/assets/chat.css">\n'
            f'<script src="/assets/chat.js" data-endpoint="{CHAT_ENDPOINT}"{dev} data-web3forms="{WEB3FORMS_KEY}" data-alerts="{ALERTS_ENDPOINT}" defer></script>')


class _Text(HTMLParser):
    """Pulls readable text out of a page's <main>, skipping forms, buttons, dialogs, asides and SVGs."""
    SKIP_TAGS = {"script", "style", "svg", "form", "button", "dialog", "aside", "noscript", "picture"}
    BLOCK = {"p", "li", "h1", "h2", "h3", "h4", "summary", "dt", "dd", "tr", "div", "section", "article"}

    def __init__(self):
        super().__init__()
        self.in_main = False
        self.skip = 0
        self.out = []

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self.in_main = True
        elif self.in_main and tag in self.SKIP_TAGS:
            self.skip += 1
        elif self.in_main and not self.skip:
            if tag in ("h1", "h2", "h3"):
                self.out.append("\n\n" + "#" * int(tag[1]) + " ")
            elif tag == "li":
                self.out.append("\n- ")
            elif tag in self.BLOCK:
                self.out.append("\n")

    def handle_endtag(self, tag):
        if tag == "main":
            self.in_main = False
        elif self.in_main and tag in self.SKIP_TAGS and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if self.in_main and not self.skip:
            self.out.append(re.sub(r"\s+", " ", data))

    def text(self):
        t = "".join(self.out)
        t = re.sub(r"[ \t]+\n", "\n", t)
        t = re.sub(r"\n[ \t]+", "\n", t)
        return re.sub(r"\n{3,}", "\n\n", t).strip()


def knowledge():
    parts = []
    for url in KNOWLEDGE_PAGES:
        f = ROOT / url.strip("/") / "index.html"
        page = f.read_text()
        title = html.unescape(re.search(r"<title>(.*?)</title>", page).group(1))
        parser = _Text()
        parser.feed(page)
        parts.append(f"=== {SITE}{url} ({title}) ===\n{parser.text()}")
    out = ROOT / "worker" / "knowledge.txt"
    out.write_text("\n\n".join(parts) + "\n")
    print(f"worker/knowledge.txt: {len(out.read_text())} characters from {len(parts)} pages")


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
        for name in TOOL_BLOCKS:
            if f"<!-- shared:{name} -->" in text:
                text = replace_block(text, name, tool_block(name), f)
        f.write_text(text)
        print("synced", url)
    rows = "".join(f"  <url><loc>{SITE}{url}</loc><lastmod>{date.fromtimestamp(f.stat().st_mtime).isoformat()}</lastmod></url>\n"
                   for url, f in found)
    (ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
                                      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + "</urlset>\n")
    print(f"sitemap.xml: {len(found)} pages")
    knowledge()


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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
