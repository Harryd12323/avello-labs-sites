"""Problem pages: one page per problem a visitor might have, each with a short video, why it happens, something
they may not have considered, things to think about before deciding, a free guide for their email, and a way to
get in touch. The homepage links to them with one button each. Built by `site.py problems` from the text files
in scripts/problems/; sync then fills in the shared head, header and footer.

Written as a template: everything about the business is in the text files and the few settings passed in from
site.py, so the same builder works for a client site with its own files.

Text format (fields first, then sections):
    URL: /cant-find-us/                 Order: 1 (homepage button order)
    Title: ...                          (without " | Avello Labs")
    Description: ...                    (120 to 160 characters)
    Keyword: ...                        (the search the page is written for; must not compete with other pages)
    Button: ...                         (the homepage button text)
    Crumb: ...                          Headline: ... with *gradient words*        Lede: ...
    Video: <YouTube ID, empty until filmed>     Video-date: YYYY-MM-DD     Video-title: ...
    Resource: <guide key> | Heading | One line about the guide
    Also: /path/ | Link text            (an extra free resource, optional)
    Offer: review | tool
    Related: /path/ | Link text         (any number)
    ## Section heading                  then paragraphs, "- " bullets, "1. " steps, **bold**, [links](/path/)
    ## Video transcript                 (shown under the video once there is one)
"""
import html
import json
import re

import blogpost

FIELDS = ["URL", "Order", "Title", "Description", "Keyword", "Button", "Crumb", "Headline", "Lede", "Resource", "Offer"]
OPTIONAL = ["Video", "Video-date", "Video-title", "Also"]
TRANSCRIPT = "Video transcript"
SECTIONS = 3  # at least: why it happens, what they may not have considered, before you decide
SUFFIX = blogpost.SUFFIX

OFFERS = {
    "review": ("Free 20-minute review", "A short phone call where we walk you through the 3 fixes we'd tackle first on your site. No obligation.",
               "Get my free review", "/#contact"),
    "tool": ("Free 20-minute call", "Tell us about the task, and we'll tell you honestly whether a custom tool is worth it. No obligation.",
             "Get my free call", "/?offer=tool#contact"),
}


def parse(text):
    fields, related, sections, current = {}, [], [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        m = re.match(r"^([A-Z][A-Za-z-]*): ?(.*)$", line)
        if current is None and m and (m.group(1) in FIELDS + OPTIONAL or m.group(1) == "Related"):
            if m.group(1) == "Related":
                related.append([p.strip() for p in m.group(2).split("|", 1)])
            else:
                fields[m.group(1)] = m.group(2).strip()
        elif line.startswith("## "):
            current = {"heading": line[3:].strip(), "lines": []}
            sections.append(current)
        elif current is not None:
            current["lines"].append(line)
    return {"fields": fields, "related": related, "sections": sections}


def blocks(lines):
    """Paragraphs, bullet lists and numbered lists from a section's lines."""
    out, para = [], []
    for line in lines + [""]:
        s = line.strip()
        kind = "ul" if s.startswith("- ") else "ol" if re.match(r"^\d+\. ", s) else None
        if kind:
            if para:
                out.append(("p", " ".join(para))); para = []
            item = s[2:] if kind == "ul" else re.sub(r"^\d+\. ", "", s)
            if out and out[-1][0] == kind and not out[-1][2]:
                out[-1][1].append(item)
            else:
                out.append((kind, [item], False))
        elif s:
            para.append(s)
        else:
            if para:
                out.append(("p", " ".join(para))); para = []
            if out and out[-1][0] in ("ul", "ol"):
                out[-1] = (out[-1][0], out[-1][1], True)  # a blank line ends the list
    return [(b[0], b[1]) for b in out]


def section_html(lines, indent):
    parts = []
    for kind, value in blocks(lines):
        if kind == "p":
            parts.append(f"{indent}<p>{blogpost.inline(value)}</p>")
        else:
            items = "\n".join(f"{indent}  <li>{blogpost.inline(i)}</li>" for i in value)
            parts.append(f"{indent}<{kind}>\n{items}\n{indent}</{kind}>")
    return "\n".join(parts)


def headline_html(text):
    return re.sub(r"\*([^*]+)\*", r'<span class="grad-text">\1</span>', html.escape(text, quote=False))


def plain(text):
    return re.sub(r"\*+", "", text)


def check(text, pages, anchors, taken, guides):
    """Every rule a problem page must pass. taken: [(url, keyword)] of every page that owns a keyword."""
    p = parse(text)
    f, problems = p["fields"], []
    for name in FIELDS:
        if not f.get(name):
            problems.append(f"Missing {name}:")
    if problems:
        return problems
    url = f["URL"]
    if not re.match(r"^/[a-z0-9]+(?:-[a-z0-9]+)*/$", url):
        problems.append(f"URL must look like /some-problem/, not {url}")
    title = f["Title"] + SUFFIX
    if len(title) > blogpost.MAX_TITLE:
        problems.append(f"The title is {len(title)} characters with the suffix; keep it to {blogpost.MAX_TITLE}.")
    lo, hi = blogpost.DESCRIPTION
    if not lo <= len(f["Description"]) <= hi:
        problems.append(f"The description is {len(f['Description'])} characters; it should be {lo} to {hi}.")
    kw = f["Keyword"].lower()
    for other_url, other in taken:
        if other_url != url and blogpost.too_close(kw, other):
            problems.append(f'The keyword "{kw}" competes with {other_url} ("{other}").')
    guide = f["Resource"].split("|")[0].strip()
    if guide not in guides:
        problems.append(f"Resource: {guide} isn't one of the guides ({', '.join(guides)}).")
    if f["Offer"] not in OFFERS:
        problems.append(f"Offer: must be one of {', '.join(OFFERS)}.")
    if f.get("Video") and not re.match(r"^[A-Za-z0-9_-]{11}$", f["Video"]):
        problems.append("Video: should be the 11-character YouTube video ID (the part after watch?v=).")
    if f.get("Video") and not re.match(r"^\d{4}-\d{2}-\d{2}$", f.get("Video-date", "")):
        problems.append("Video-date: is needed once there's a video (the day it went up on YouTube, YYYY-MM-DD).")
    body = [s for s in p["sections"] if s["heading"] != TRANSCRIPT]
    if len(body) < SECTIONS:
        problems.append(f"Needs at least {SECTIONS} ## sections; it has {len(body)}.")
    links = [u for _, u in blogpost.LINK.findall(text)] + [r[0] for r in p["related"]] + ([f["Also"].split("|")[0].strip()] if f.get("Also") else [])
    for link in links:
        target = link.split("#")[0] or "/"
        if not link.startswith("/") or link.startswith("//"):
            problems.append(f"Links must go to our own pages; this one doesn't: {link}")
        elif link.startswith("/#") and link[2:] not in anchors:
            problems.append(f"There's no {link} section on the home page.")
        elif target.split("?")[0] not in pages and not target.startswith("/resources/"):
            problems.append(f"There's no page at {link}.")
    prose = "\n".join(line for line in text.splitlines() if not re.match(r"^(URL|Order|Keyword|Video|Video-date|Resource|Offer|Related|Also):", line))
    if blogpost.DASHES.search(prose):
        problems.append("Uses an em dash, en dash or a spaced hyphen as punctuation. Use a period or comma.")
    if '"' in prose:
        problems.append("Uses straight double quotes; use curly ones (“ ”).")
    low = prose.lower()
    for word in blogpost.BANNED:
        if re.search(r"(?<![\w-])" + re.escape(word) + r"(?![\w-])", low):
            problems.append(f'Uses "{word}", which the copy rules don\'t allow.')
    for place in blogpost.BLOCKED_PLACES:
        if place.lower() in low:
            problems.append(f"Names {place}.")
    for m in blogpost.STATS.finditer(prose):
        problems.append(f'Looks like a statistic or price ("{m.group(0).strip()}").')
    for m in blogpost.PROMISE.finditer(prose):
        if not blogpost.NEGATED.search(prose[:m.start()].split("\n")[-1]):
            problems.append(f'Sounds like a promise ("{m.group(0)}").')
    return list(dict.fromkeys(problems))


ARROW = blogpost.ARROW
PLAY = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z"/></svg>')


def video_html(slug, f, transcript, indent, site, lazy=True):
    """The click-to-load YouTube player, or, before the video exists, a marked spot that only shows with ?spots."""
    vid = f.get("Video", "")
    if not vid:
        return (f'{indent}<!-- VIDEO SPOT: film the video, upload it to YouTube, then add its ID as Video: in scripts/problems/{slug}.txt\n'
                f'{indent}     and a 1280x720 thumbnail at /assets/videos/{slug}.jpg. Script outline: docs/problem-videos.md -->\n'
                f'{indent}<div class="video-spot" hidden><p><strong>Video spot</strong>: {html.escape(f.get("Video-title") or "Video")}</p>'
                f'<p>Shows here once Video: is filled in. Only visible in previews with ?spots.</p></div>')
    title = html.escape(f.get("Video-title") or plain(f["Headline"]))
    out = [f'{indent}<figure class="video">',
           f'{indent}  <button class="video-facade" type="button" data-video="{vid}" aria-label="Play the video: {title}">',
           f'{indent}    <img src="/assets/videos/{slug}.jpg" width="1280" height="720" alt=""{' loading="lazy"' if lazy else ''} decoding="async">',
           f'{indent}    <span class="video-play">{PLAY}</span>',
           f'{indent}  </button>',
           f'{indent}  <figcaption>{title}{"" if title[-1:] in ".?!" else "."} The video loads from YouTube when you press play.</figcaption>',
           f'{indent}</figure>']
    if transcript:
        out += [f'{indent}<details class="transcript">', f'{indent}  <summary>Read the transcript</summary>',
                section_html(transcript, indent + "  "), f'{indent}</details>']
    return "\n".join(out)


def schema(p, site, brand, crumb_home="Home"):
    f, url = p["fields"], p["fields"]["URL"]
    graph = [
        {"@type": "WebPage", "@id": f"{site}{url}#page", "url": f"{site}{url}", "name": f["Title"], "description": f["Description"],
         "inLanguage": "en-US", "isPartOf": {"@id": f"{site}/#website"}, "publisher": {"@id": f"{site}/#organization"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": crumb_home, "item": f"{site}/"},
            {"@type": "ListItem", "position": 2, "name": f["Crumb"], "item": f"{site}{url}"}]},
    ]
    if f.get("Video"):
        graph.append({"@type": "VideoObject", "name": f.get("Video-title") or plain(f["Headline"]), "description": f["Description"],
                      "thumbnailUrl": f"{site}/assets/videos/{url.strip('/')}.jpg", "uploadDate": f["Video-date"],
                      "embedUrl": f"https://www.youtube-nocookie.com/embed/{f['Video']}", "publisher": {"@id": f"{site}/#organization"}})
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)


def page_html(text, site, brand, guides, tool_block):
    """The whole page, with empty shared blocks for sync to fill."""
    p = parse(text)
    f = p["fields"]
    url, slug = f["URL"], f["URL"].strip("/")
    t, d = html.escape(f["Title"] + SUFFIX), html.escape(f["Description"])
    transcript = next((s["lines"] for s in p["sections"] if s["heading"] == TRANSCRIPT), [])
    i8 = " " * 8
    sections = "\n\n".join(f'{i8}<h2>{blogpost.inline(s["heading"])}</h2>\n{section_html(s["lines"], i8)}'
                           for s in p["sections"] if s["heading"] != TRANSCRIPT)
    guide, r_head, r_text = [x.strip() for x in (f["Resource"].split("|") + ["", ""])[:3]]
    also = ""
    if f.get("Also"):
        a_url, a_label = [x.strip() for x in (f["Also"].split("|") + [""])[:2]]
        also = f'\n{i8}    <p class="guide-also">Also free: <a class="text-link" href="{html.escape(a_url)}">{html.escape(a_label)}</a></p>'
    o_head, o_text, o_label, o_href = OFFERS[f["Offer"]]
    related = "\n".join(f'            <li><a href="{html.escape(u)}">{html.escape(label)}</a></li>' for u, label in p["related"])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- Built by `site.py problems` from scripts/problems/{slug}.txt. Edit that file, not this page. -->
<!-- shared:head --><!-- /shared:head -->
<title>{t}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{site}{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{html.escape(brand)}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{site}{url}">
<script type="application/ld+json">
{schema(p, site, brand)}
</script>
{tool_block}
</head>
<body>
<!-- shared:header --><!-- /shared:header -->

<main id="main" class="problem-page">
  <section class="page-hero">
    <div class="wrap">
      <p class="crumbs"><a href="/">Home</a> / {html.escape(f["Crumb"])}</p>
      <h1>{headline_html(f["Headline"])}</h1>
      <p class="lede">{blogpost.inline(f["Lede"])}</p>
{video_html(slug, f, transcript, "      ", site)}
    </div>
  </section>

  <div class="page-body">
    <div class="wrap page-grid">
      <article class="prose">
{sections}

        <section class="guide-box" id="guide" aria-labelledby="guide-h">
          <p class="eyebrow">Free guide</p>
          <h2 id="guide-h">{html.escape(r_head)}</h2>
          <p>{blogpost.inline(r_text)} Not ready to talk? Get it by email and read it when it suits you.</p>
          <form class="guide-form" data-guide="{guide}" data-page="{url}" novalidate>
            <div class="hp" aria-hidden="true"><label for="g-bot">Leave this box unticked</label><input type="checkbox" id="g-bot" name="botcheck" tabindex="-1" autocomplete="off"></div>
            <div class="grid2">
              <div class="field"><label for="g-email">Email</label><input id="g-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" placeholder="you@company.com" required></div>
              <div class="field"><label for="g-name">Name <small>(optional)</small></label><input id="g-name" name="name" autocomplete="name" maxlength="80"></div>
            </div>
            <label class="nl-consent"><input type="checkbox" name="tips"> <span>Also send me 5 short website tips over the next few weeks. Unsubscribe anytime.</span></label>
            <label class="nl-consent"><input type="checkbox" name="newsletter"> <span>Also send me the {html.escape(brand)} newsletter: website tips, about once a month.</span></label>
            <div class="guide-turnstile"></div>
            <button class="btn" type="submit">Send me the guide {ARROW}</button>
            <p class="tool-error" role="alert"></p>
            <p class="tool-hint">Free, no obligation. We email you the guide once and only send more if you tick a box. See our <a href="/privacy/#quiz">privacy policy</a>.</p>
          </form>
          <div class="guide-done" tabindex="-1" hidden>
            <p class="guide-note" role="status"></p>
            <a class="btn btn-ghost" href="/resources/{guide}.pdf" download>Download the guide (PDF)</a>
          </div>{also}
        </section>

        <div class="cta-band">
          <h2>Rather talk it through?</h2>
          <p>{html.escape(o_text)}</p>
          <a class="btn" href="{o_href}">{html.escape(o_label)} {ARROW}</a>
        </div>
      </article>

      <aside class="aside" aria-label="More from {html.escape(brand)}">
        <div class="aside-card">
          <h2>{html.escape(o_head)}</h2>
          <p>{html.escape(o_text)}</p>
          <a class="btn" href="{o_href}">{html.escape(o_label)}</a>
        </div>
        <div class="aside-card">
          <h2>Free guide</h2>
          <p>{html.escape(guides[guide])}</p>
          <a class="btn btn-ghost" href="#guide">Get the guide</a>
        </div>
        <div class="aside-card">
          <h2>Read more</h2>
          <ul>
{related}
          </ul>
        </div>
      </aside>
    </div>
  </div>
</main>

<!-- shared:footer --><!-- /shared:footer -->
</body>
</html>
"""
