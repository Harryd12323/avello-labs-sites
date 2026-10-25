#!/usr/bin/env python3
"""Keep the shared parts of every Avello Labs page in sync, and start new pages.

Each page is plain, hand-edited HTML. The parts every page shares sit between marker comments:

    <!-- shared:head -->   ... <!-- /shared:head -->     robots/noindex, security policy, favicon, fonts, CSS, link preview tags
    <!-- shared:header --> ... <!-- /shared:header -->   skip link and site header/nav
    <!-- shared:footer --> ... <!-- /shared:footer -->   footer and the site script

Commands (run from the repo root, Python 3 only, nothing to install):

    python3 scripts/site.py sync
        Rewrites the shared blocks on every page from the templates below, marks the current
        page in the nav, rebuilds the blog list, blog/feed.xml and sitemap.xml, and refreshes
        worker/knowledge.txt (the site text the chat assistant answers from).

    python3 scripts/site.py new /pricing/ "Page title | Avello Labs" "Meta description"
        Creates pricing/index.html with the shared blocks and an empty article to fill in,
        then runs sync.

    python3 scripts/site.py post /blog/my-post/ "Post headline" "Meta description"
        Creates a draft blog post to fill in, then runs sync. Drafts carry noindex and stay out
        of the sitemap and the feed.

    python3 scripts/site.py publish /blog/my-post/
        Marks a draft as published, sets its publish and update dates to today, then runs sync.

    python3 scripts/site.py check-post post.txt
        Checks a post written in the blog text format (scripts/blogpost.py) against every rule a post must pass,
        and prints the result as JSON. Exits 1 if anything needs fixing.

    python3 scripts/site.py import-post post.txt
        Builds a draft post page from that text format (it must pass check-post first), then runs sync.

    python3 scripts/site.py keywords
        Prints, as JSON, the target keyword each page owns, so new posts don't compete with existing pages.

    python3 scripts/site.py check-keyword "how to show up on google maps"
        Prints, as JSON, the pages a new post with that keyword would compete with (an empty list: none).

Everything outside the markers (titles, meta descriptions, og tags, JSON-LD, page content) is
never touched.
"""
import html
import json
import math
import re
import subprocess
from html.parser import HTMLParser
import sys
from datetime import date, datetime, timezone
from email.utils import format_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://avellolabs.com"
EMAIL = "harris@avellolabs.com"

# Preview mode: every page carries noindex. Set to False and run `sync` to go live.
NOINDEX = False

# Folders that aren't part of the site's pages. demo/ is a standalone app demo with its own look, inline styles and
# scripts: the shared head's security policy would block them, so sync leaves it alone (and out of the sitemap).
SKIP = {"concepts", "brand", "work", "demo", "assets", "scripts", "worker", "check-worker", "alerts-worker", "workers-shared", ".git"}

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

# Blog (see blog/). Each post is a hand-written page at /blog/<slug>/. Its head says whether it's a draft
# (<meta name="blog:status">) and when it was published and updated (article:published_time and
# article:modified_time). From those, sync fills in the byline and reading time, the Article schema, the
# related links, the list on /blog/, blog/feed.xml and the sitemap.
BLOG_NAME = "Avello Labs blog"
BLOG_AUTHOR = "Avello Labs"
BLOG_DESCRIPTION = "Practical website, search and AI answer tips for small local businesses."
WORDS_PER_MINUTE = 230

# Starting price, shown wherever a page has <!-- shared:price --> markers (the home page and the service
# pages). Write it the way it should read, like "$1,500". While it's empty, every element marked data-price
# is hidden, and the chat assistant doesn't see it either.
PRICE_FROM = ""

# The search a page is written to rank for. Blog posts carry theirs in <meta name="blog:keyword">; these are the
# other pages'. A new post's keyword must not compete with any of them (check-post).
PAGE_KEYWORDS = {
    "/": "fast websites and monthly website care for local businesses",
    "/seo/": "why seo matters for local businesses",
    "/aeo/": "what is aeo",
    "/website-care/": "ongoing website care",
    "/web-apps/": "custom web apps for small businesses",
    "/check/": "free website check",
    "/tools/": "free seo and aeo tools",
    "/tools/search-preview/": "google search preview tool",
    "/tools/ai-crawler-check/": "ai crawler check robots.txt",
    "/tools/schema-generator/": "local business schema generator",
}

# Pages whose text the chat assistant answers from.
KNOWLEDGE_PAGES = ["/", "/seo/", "/aeo/", "/website-care/", "/web-apps/", "/tools/"]


def origin(url):
    return re.match(r"^https?://[^/]+", url).group(0) if url else ""

CONNECT = " ".join(o for o in ["https://api.web3forms.com", origin(CHAT_ENDPOINT), origin(CHAT_DEV_ENDPOINT or ""), origin(CHECK_ENDPOINT), origin(ALERTS_ENDPOINT)] if o)
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
       f"font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src {CONNECT}; "
       "form-action https://api.web3forms.com; base-uri 'self'; object-src 'none'")

NAV = [("/seo/", "SEO"), ("/aeo/", "AEO"), ("/website-care/", "Website care"), ("/web-apps/", "Web apps"),
       ("/#real-work", "Our work"), ("/tools/", "Free tools")]

# Pages that count as part of a nav item, besides the ones under its own path.
NAV_ALSO = {"/tools/": ["/check/"]}


# Link previews (iMessage, Slack, LinkedIn, Facebook, X). Every page shares one 1200x630 preview image. A page's
# title and description come from its own og tags, or else its <title> and meta description, or else the home page's.
OG_IMAGE = f"{SITE}/assets/og-image.png"
OG_IMAGE_ALT = "Avello Labs logo on a dark navy background"
HOME_TITLE = "Avello Labs | Fast Websites and Monthly Website Care"
HOME_DESCRIPTION = "Custom websites for local businesses, live in days, with Google SEO, AI search optimization and monthly care built in."


def social_tags(text, url):
    """Open Graph and Twitter card tags. The basic og tags a page writes itself (outside the markers) are left alone;
    any it lacks are added here."""
    own = _strip_blocks(text)
    t = re.search(r"<title>(.*?)</title>", own, re.S)
    title = _meta(own, "property", "og:title") or (html.unescape(t.group(1).strip()) if t else "") or HOME_TITLE
    desc = _meta(own, "property", "og:description") or _meta(own, "name", "description") or HOME_DESCRIPTION
    basics = {"og:type": "website", "og:site_name": "Avello Labs", "og:title": title, "og:description": desc, "og:url": SITE + url}
    tags = [("property", k, v) for k, v in basics.items() if not _meta(own, "property", k)]
    tags += [("property", "og:image", OG_IMAGE), ("property", "og:image:width", "1200"), ("property", "og:image:height", "630"),
             ("property", "og:image:alt", OG_IMAGE_ALT), ("name", "twitter:card", "summary_large_image"),
             ("name", "twitter:title", title), ("name", "twitter:description", desc), ("name", "twitter:image", OG_IMAGE)]
    return "\n".join(f'<meta {attr}="{k}" content="{html.escape(v)}">' for attr, k, v in tags)


def shared_head(text="", url="/"):
    robots = ('<!-- Preview only: keeps search engines out. Set NOINDEX = False in scripts/site.py and run sync to go live. -->\n'
              '<meta name="robots" content="noindex, nofollow">\n') if NOINDEX else ""
    return f"""<!-- shared:head -->
{robots}<meta http-equiv="Content-Security-Policy" content="{CSP}">
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/assets/site.css">
{social_tags(text, url)}
<!-- /shared:head -->"""


def shared_header(current):
    links = "\n".join(
        f'      <a class="nav-link" href="{h}"{" aria-current=\"page\"" if (current.startswith(h) or current in NAV_ALSO.get(h, [])) and not h.startswith("/#") else ""}>{l}</a>'
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


def shared_footer(blog=False):
    blog_link = '\n          <li><a href="/blog/">Blog</a></li>' if blog else ""
    return f"""<!-- shared:footer -->
<footer class="site">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <img src="/brand/logo-horizontal-dark.svg" width="337" height="64" alt="Avello Labs">
        <p>Custom websites for small local businesses, live in days, with monthly care, SEO and AEO.</p>
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
          <li><a href="/#real-work">Our work</a></li>{blog_link}
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


ARROW = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>')


def _meta(text, attr, name):
    m = re.search(rf'<meta {attr}="{re.escape(name)}" content="([^"]*)">', text)
    return html.unescape(m.group(1)) if m else ""


def _strip_blocks(text):
    return re.sub(r"<!-- shared:([\w-]+) -->.*?<!-- /shared:\1 -->", "", text, flags=re.S)


def blog_posts():
    """Every post under /blog/, newest first, with the details sync needs. Exits on a post with missing details."""
    posts = []
    for url, f in pages():
        if not re.fullmatch(r"/blog/[^/]+/", url):
            continue
        text = f.read_text()
        status = _meta(text, "name", "blog:status")
        published, modified = _meta(text, "property", "article:published_time"), _meta(text, "property", "article:modified_time")
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S)
        body = re.search(r'<article class="prose">(.*?)</article>', _strip_blocks(text), re.S)
        problems = [what for what, ok in [
            ('<meta name="blog:status"> set to draft or published', status in ("draft", "published")),
            ("article:published_time as YYYY-MM-DD", re.fullmatch(r"\d{4}-\d\d-\d\d", published)),
            ("article:modified_time as YYYY-MM-DD", re.fullmatch(r"\d{4}-\d\d-\d\d", modified)),
            ("an <h1>", h1), ('an <article class="prose">', body), ("a meta description", _meta(text, "name", "description"))] if not ok]
        if problems:
            sys.exit(f"{f}: blog post needs " + ", ".join(problems))
        words = len(re.findall(r"[\w’']+", html.unescape(re.sub(r"<[^>]+>", " ", body.group(1)))))
        faq = re.search(r'<div class="faq">(.*?)</div>', body.group(1), re.S)
        qa = re.findall(r"<summary>(.*?)</summary>\s*<p>(.*?)</p>", faq.group(1), re.S) if faq else []
        posts.append({
            "url": url, "file": f, "draft": status == "draft",
            "headline": html.unescape(re.sub(r"<[^>]+>", "", h1.group(1))).strip(),
            "description": _meta(text, "name", "description"),
            "published": published, "modified": modified,
            "words": words, "minutes": max(1, math.ceil(words / WORDS_PER_MINUTE)),
            "keyword": _meta(text, "name", "blog:keyword"),
            "faq": [tuple(html.unescape(re.sub(r"<[^>]+>", "", x)).strip() for x in pair) for pair in qa],
        })
    return sorted(posts, key=lambda p: (p["published"], p["url"]), reverse=True)


def nice_date(iso):
    d = date.fromisoformat(iso)
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def blog_head(post, posts):
    """Head block for /blog/ and each post: stylesheet, feed link, noindex while unpublished, Article schema."""
    hidden = post["draft"] if post else not any(not p["draft"] for p in posts)
    lines = ["<!-- shared:blog-head -->", '<link rel="stylesheet" href="/assets/blog.css">',
             f'<link rel="alternate" type="application/rss+xml" title="{BLOG_NAME}" href="{SITE}/blog/feed.xml">']
    if hidden:
        note = "Draft" if post else "No published posts yet"
        lines.append(f'<!-- {note}: keeps search engines out until `python3 scripts/site.py publish` is run. -->\n'
                     '<meta name="robots" content="noindex, nofollow">')
    if post:
        schema = {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": post["headline"],
            "description": post["description"],
            "url": SITE + post["url"],
            "mainEntityOfPage": SITE + post["url"],
            "datePublished": post["published"],
            "dateModified": post["modified"],
            "author": {"@type": "Organization", "name": BLOG_AUTHOR, "url": SITE + "/"},
            "publisher": {"@type": "Organization", "name": BLOG_AUTHOR, "url": SITE + "/",
                          "logo": {"@type": "ImageObject", "url": SITE + "/brand/icon.svg"}},
            "inLanguage": "en-US",
            "wordCount": post["words"],
            "timeRequired": f"PT{post['minutes']}M",
            "isPartOf": {"@type": "Blog", "name": BLOG_NAME, "url": SITE + "/blog/"},
        }
        lines.append('<script type="application/ld+json">\n' + json.dumps(schema, indent=2, ensure_ascii=False).replace("</", "<\\/") + "\n</script>")
        if post["faq"]:
            faq = {"@context": "https://schema.org", "@type": "FAQPage",
                   "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                                  for q, a in post["faq"]]}
            lines.append('<script type="application/ld+json">\n' + json.dumps(faq, indent=2, ensure_ascii=False).replace("</", "<\\/") + "\n</script>")
    lines.append("<!-- /shared:blog-head -->")
    return "\n".join(lines)


def byline(post):
    when = (f'<span class="draft-tag">Draft</span>' if post["draft"]
            else f'<time datetime="{post["published"]}">{nice_date(post["published"])}</time>')
    return f'By {BLOG_AUTHOR} <span aria-hidden="true">·</span> {when} <span aria-hidden="true">·</span> {post["minutes"]} min read'


def post_meta(post):
    lines = ["<!-- shared:post-meta -->", f'<p class="post-meta">{byline(post)}</p>']
    if post["modified"] > post["published"] and not post["draft"]:
        lines.append(f'<p class="post-updated">Updated <time datetime="{post["modified"]}">{nice_date(post["modified"])}</time></p>')
    if post["draft"]:
        lines.append('<p class="draft-note"><strong>Draft, not published.</strong> Search engines are told to skip this page, '
                     "and it isn't in the sitemap or the blog feed yet.</p>")
    lines.append("<!-- /shared:post-meta -->")
    return "\n".join(lines)


def post_aside(post, posts):
    """Related links beside each post: the free site check, the free tools, and other posts.
    A published post only links to other published posts; a draft links to everything, for review."""
    others = [p for p in posts if p["url"] != post["url"] and (post["draft"] or not p["draft"])][:3]
    more = ""
    if others:
        items = "\n".join(f'          <li><a href="{p["url"]}">{html.escape(p["headline"])}</a></li>' for p in others)
        more = f"""
      <div class="aside-card">
        <h2>More from the blog</h2>
        <ul>
{items}
        </ul>
      </div>"""
    return f"""<!-- shared:post-aside -->
      <aside class="aside" aria-label="Related">
      <div class="aside-card">
        <h2>Check your own site</h2>
        <p>The free site check scores 10 SEO and AEO basics on any page in a few seconds.</p>
        <a class="btn" href="/check/">Run a free site check</a>
      </div>
      <div class="aside-card">
        <h2>Free tools</h2>
        <ul>
          <li><a href="/tools/ai-crawler-check/">AI crawler check</a></li>
          <li><a href="/tools/search-preview/">Search preview</a></li>
          <li><a href="/tools/schema-generator/">Business schema generator</a></li>
          <li><a href="/tools/">See all free tools</a></li>
        </ul>
      </div>{more}
      </aside>
      <!-- /shared:post-aside -->"""


def blog_list(posts):
    """The post list on /blog/. Once anything is published it lists published posts only; until then /blog/
    carries noindex and lists the drafts, so they can be reviewed in place."""
    posts = [p for p in posts if not p["draft"]] or posts
    if not posts:
        return '<!-- shared:blog-list -->\n      <p class="post-empty">The first posts are on the way.</p>\n      <!-- /shared:blog-list -->'
    cards = "\n".join(f"""        <li class="post-card">
          <h2><a href="{p["url"]}">{html.escape(p["headline"])}</a></h2>
          <p class="post-meta">{byline(p)}</p>
          <p>{html.escape(p["description"])}</p>
          <span class="post-go" aria-hidden="true">Read the post {ARROW}</span>
        </li>""" for p in posts)
    return f'<!-- shared:blog-list -->\n      <ul class="post-list">\n{cards}\n      </ul>\n      <!-- /shared:blog-list -->'


def blog_feed(posts):
    """RSS 2.0 feed of published posts. Dates are fixed at noon UTC so they read as the right day everywhere in the US."""
    live = [p for p in posts if not p["draft"]]
    stamp = lambda iso: format_datetime(datetime.fromisoformat(iso + "T12:00:00").replace(tzinfo=timezone.utc))
    x = lambda t: html.escape(t, quote=False)
    items = "".join(f"""    <item>
      <title>{x(p["headline"])}</title>
      <link>{SITE}{p["url"]}</link>
      <guid isPermaLink="true">{SITE}{p["url"]}</guid>
      <pubDate>{stamp(p["published"])}</pubDate>
      <description>{x(p["description"])}</description>
    </item>
""" for p in live)
    built = f"    <lastBuildDate>{stamp(max(p['modified'] for p in live))}</lastBuildDate>\n" if live else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>{BLOG_NAME}</title>
    <link>{SITE}/blog/</link>
    <description>{x(BLOG_DESCRIPTION)}</description>
    <language>en-us</language>
    <atom:link href="{SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
{built}{items}  </channel>
</rss>
"""


class _Text(HTMLParser):
    """Pulls readable text out of a page's <main>, skipping forms, buttons, dialogs, asides, SVGs and anything hidden."""
    SKIP_TAGS = {"script", "style", "svg", "form", "button", "dialog", "aside", "noscript", "picture"}
    BLOCK = {"p", "li", "h1", "h2", "h3", "h4", "summary", "dt", "dd", "tr", "div", "section", "article"}

    def __init__(self):
        super().__init__()
        self.in_main = False
        self.skip = 0
        self.hidden = []  # tag names of the hidden element being skipped, and of same-named tags nested in it
        self.out = []

    def handle_starttag(self, tag, attrs):
        if self.hidden:
            if tag == self.hidden[0]:
                self.hidden.append(tag)
            return
        if self.in_main and any(name == "hidden" for name, _ in attrs):
            self.hidden = [tag]
            return
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
        if self.hidden:
            if tag == self.hidden[0]:
                self.hidden.pop()
            return
        if tag == "main":
            self.in_main = False
        elif self.in_main and tag in self.SKIP_TAGS and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if self.in_main and not self.skip and not self.hidden:
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
    posts = blog_posts()
    by_url = {p["url"]: p for p in posts}
    live = [p for p in posts if not p["draft"]]
    for url, f in found:
        text = f.read_text()
        text = replace_block(text, "head", shared_head(text, url), f)
        text = replace_block(text, "header", shared_header(url), f)
        text = replace_block(text, "footer", shared_footer(blog=bool(live)), f)
        for name in TOOL_BLOCKS:
            if f"<!-- shared:{name} -->" in text:
                text = replace_block(text, name, tool_block(name), f)
        price = f'<!-- shared:price --><span class="price-amount">{html.escape(PRICE_FROM)}</span><!-- /shared:price -->'
        text = re.sub(r"<!-- shared:price -->.*?<!-- /shared:price -->", lambda _: price, text, flags=re.S)
        text = re.sub(r"<(\w+)([^>]*?) data-price(?: hidden)?>", lambda m: f"<{m.group(1)}{m.group(2)} data-price{'' if PRICE_FROM else ' hidden'}>", text)
        if url == "/blog/":
            text = replace_block(text, "blog-head", blog_head(None, posts), f)
            text = replace_block(text, "blog-list", blog_list(posts), f)
        elif url in by_url:
            post = by_url[url]
            text = replace_block(text, "blog-head", blog_head(post, posts), f)
            text = replace_block(text, "post-meta", post_meta(post), f)
            text = replace_block(text, "post-aside", post_aside(post, posts), f)
        f.write_text(text)
        print("synced", url)
    # Links written into a published post's text are the author's, so they're only flagged, never changed.
    for p in live:
        for d in posts:
            if d["draft"] and f'href="{d["url"]}' in _strip_blocks(p["file"].read_text()):
                print(f"WARNING: {p['url']} is published but links to the draft {d['url']}. Publish it too, or remove the link.")
    if (ROOT / "blog").is_dir():
        (ROOT / "blog" / "feed.xml").write_text(blog_feed(posts))
        print(f"blog/feed.xml: {len(live)} published, {len(posts) - len(live)} left out as drafts")

    # Drafts, and /blog/ while nothing is published, carry noindex, so they stay out of the sitemap too.
    def listed(url):
        return not (url in by_url and by_url[url]["draft"]) and not (url == "/blog/" and not live)

    def lastmod(url, f):
        return by_url[url]["modified"] if url in by_url else (committed(f) or date.fromtimestamp(f.stat().st_mtime).isoformat())

    rows = "".join(f"  <url><loc>{SITE}{url}</loc><lastmod>{lastmod(url, f)}</lastmod></url>\n"
                   for url, f in found if listed(url))
    (ROOT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
                                      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + "</urlset>\n")
    print(f"sitemap.xml: {rows.count('<url>')} pages")
    knowledge()


def committed(f):
    """The date of the last commit that changed this file, if it has no changes since (None outside a git clone, or
    for a changed file). A fresh clone gives every file today's time, so the file's own time can't be trusted."""
    try:
        args = ["git", "-C", str(ROOT)]
        dirty = subprocess.run(args + ["status", "--porcelain", "--", str(f)], capture_output=True, text=True, timeout=10)
        last = subprocess.run(args + ["log", "-1", "--format=%cs", "--", str(f)], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if dirty.returncode or last.returncode or dirty.stdout.strip() or not last.stdout.strip():
        return None
    return last.stdout.strip()


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


def post_page(url, title, headline, desc, lede, article, keyword=""):
    """A blog post page (a draft), with the shared blocks left empty for sync to fill in."""
    t, h, d, today = html.escape(title), html.escape(headline), html.escape(desc), date.today().isoformat()
    kw = f'\n<meta name="blog:keyword" content="{html.escape(keyword)}">' if keyword else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- shared:head --><!-- /shared:head -->
<title>{t}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{SITE}{url}">
<meta name="blog:status" content="draft">{kw}
<meta property="article:published_time" content="{today}">
<meta property="article:modified_time" content="{today}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Avello Labs">
<meta property="og:title" content="{h}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{SITE}{url}">
<!-- shared:blog-head --><!-- /shared:blog-head -->
</head>
<body>
<!-- shared:header --><!-- /shared:header -->

<main id="main">
  <section class="page-hero">
    <div class="wrap">
      <p class="crumbs"><a href="/">Home</a> / <a href="/blog/">Blog</a></p>
      <h1>{h}</h1>
      <p class="lede">{lede}</p>
      <!-- shared:post-meta --><!-- /shared:post-meta -->
    </div>
  </section>
  <div class="page-body">
    <div class="wrap page-grid">
      <article class="prose">
{article}
      </article>
      <!-- shared:post-aside --><!-- /shared:post-aside -->
    </div>
  </div>
</main>

<!-- shared:footer --><!-- /shared:footer -->
</body>
</html>
"""


def new_post_file(url):
    if not re.fullmatch(r"/blog/[a-z0-9-]+/", url):
        sys.exit("The post path must look like /blog/my-post/ (lowercase letters, numbers and dashes)")
    out = ROOT / url.strip("/") / "index.html"
    if out.exists():
        sys.exit(f"{out} already exists")
    if not (ROOT / "blog" / "index.html").exists():
        sys.exit("blog/index.html is missing")
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def post(url, headline, desc):
    out = new_post_file(url)
    out.write_text(post_page(url, f"{headline} | Avello Labs", headline, desc,
                             "TODO one or two sentences that sum up the post.",
                             "        <h2>TODO first heading</h2>\n        <p>TODO</p>"))
    print("created", out)
    sync()


def taken_keywords():
    """[(url, keyword)] for every page that owns a target keyword: the main pages and every blog post."""
    out = list(PAGE_KEYWORDS.items())
    for p in blog_posts():
        out.append((p["url"], p["keyword"] or p["headline"].lower()))
    return out


def post_rules():
    """What check-post needs to know about the site: its page paths, the home page's sections, the taken keywords."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import blogpost
    found = {url for url, _ in pages()}
    anchors = set(re.findall(r'\bid="([^"]+)"', (ROOT / "index.html").read_text()))
    return blogpost, found, anchors, taken_keywords()


def check_post(path):
    blogpost, found, anchors, taken = post_rules()
    text = Path(path).read_text()
    problems = blogpost.check(text, found, anchors, taken)
    out = {"ok": not problems, "problems": problems}
    if not problems:
        fields = blogpost.parse(text)["fields"]
        out.update(blogpost.stats(text), slug=fields["Slug"], url=f"/blog/{fields['Slug']}/", keyword=fields["Keyword"].lower())
    print(json.dumps(out, indent=2))
    return out


def import_post(path):
    blogpost, found, anchors, taken = post_rules()
    text = Path(path).read_text()
    problems = blogpost.check(text, found, anchors, taken)
    if problems:
        sys.exit("The post isn't ready:\n  " + "\n  ".join(problems))
    post_ = blogpost.parse(text)
    f = post_["fields"]
    url = f"/blog/{f['Slug']}/"
    out = new_post_file(url)
    out.write_text(post_page(url, f["Title"] + blogpost.SUFFIX, f["Headline"], f["Description"],
                             blogpost.inline(f["Lede"]), blogpost.body_html(post_), f["Keyword"].lower()))
    print("created", out)
    sync()


def publish(url):
    f = ROOT / url.strip("/") / "index.html"
    if not (re.fullmatch(r"/blog/[^/]+/", url) and f.exists()):
        sys.exit(f"No blog post at {url}")
    text, today = f.read_text(), date.today().isoformat()
    if '<meta name="blog:status" content="draft">' not in text:
        sys.exit(f"{url} isn't a draft")
    text = text.replace('<meta name="blog:status" content="draft">', '<meta name="blog:status" content="published">')
    text = re.sub(r'(<meta property="article:(?:published|modified)_time" content=")[^"]*', rf"\g<1>{today}", text)
    f.write_text(text)
    print("published", url)
    sync()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "sync":
        sync()
    elif len(sys.argv) == 5 and sys.argv[1] == "new":
        new(*sys.argv[2:])
    elif len(sys.argv) == 5 and sys.argv[1] == "post":
        post(*sys.argv[2:])
    elif len(sys.argv) == 3 and sys.argv[1] == "publish":
        publish(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "check-post":
        sys.exit(0 if check_post(sys.argv[2])["ok"] else 1)
    elif len(sys.argv) == 3 and sys.argv[1] == "import-post":
        import_post(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "check-keyword":
        blogpost = post_rules()[0]
        print(json.dumps([{"url": u, "keyword": k} for u, k in taken_keywords() if blogpost.too_close(sys.argv[2], k)]))
    elif len(sys.argv) == 2 and sys.argv[1] == "keywords":
        print(json.dumps([{"url": u, "keyword": k} for u, k in taken_keywords()], indent=2))
    else:
        sys.exit(__doc__)
