"""Question pages: one page per "People also ask" question from Google, each with a TL;DR box, a clear direct
answer, local mentions, a short FAQ with FAQPage schema, and call and contact buttons. Built by
`site.py questions` from the text files in scripts/questions/; sync then fills in the shared head, header and
footer, and lists the published ones on /faq/.

Questions are pasted in by hand from Google. Never scrape Google for them.

Text format (fields first, then sections):
    URL: /questions/some-question/      (always under /questions/)
    Question: The question, word for word as people ask it (the page headline)
    Crumb: A short name for the breadcrumb
    Title: ...                          (without " | Avello Labs"; Title Case; the whole title at most 62 characters)
    Description: ...                    (120 to 160 characters)
    Keyword: ...                        (the search the page is written for; must not compete with other pages)
    Draft: yes | no                     (yes keeps it noindex, out of the sitemap and off /faq/)
    TLDR: One or two sentences: the whole answer for someone who reads nothing else.
    Offer: review | tool
    Related: /path/ | Link text         (any number)
    Source: https://... | Link text     (optional: one outside source for a factual claim, like a Google guide; shown
                                        as a "Source:" link under the short answer)
    ## The short answer                 (must come first: two to four sentences that answer the question directly)
    ## Any other section heading        then paragraphs, "- " bullets, "1. " steps, **bold**, [links](/path/)
    ## Common questions                 then pairs of lines: "Q: ..." and "A: ..." (at least 3 pairs)

Local mentions: the page text must name South Jersey and at least one town from LOCAL_TOWNS, worked into the
answer where it's true and useful, never as a list of place names.
"""
import html
import json
import re

import blogpost
import problems

FIELDS = ["URL", "Question", "Crumb", "Title", "Description", "Keyword", "Draft", "TLDR", "Offer"]
OPTIONAL = ["Source"]
ANSWER = "The short answer"
FAQ = "Common questions"
MIN_FAQ = 3
REGION = "South Jersey"
# The owner's nearby towns are blocked by blogpost.BLOCKED_PLACES; examples use Cherry Hill (CLAUDE.md).
LOCAL_TOWNS = ["Cherry Hill", "Philadelphia", "Camden County", "Moorestown", "Voorhees", "Marlton", "Mount Laurel"]
SUFFIX = blogpost.SUFFIX
OFFERS = problems.OFFERS
ARROW = blogpost.ARROW


def parse(text):
    # Same format as problems.parse, with this page type's own field names.
    fields, related, sections, current = {}, [], [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        m = re.match(r"^([A-Z][A-Za-z-]*): ?(.*)$", line)
        if current is None and m and (m.group(1) in FIELDS + OPTIONAL or m.group(1) == "Related"):
            if m.group(1) == "Related":
                related.append([x.strip() for x in m.group(2).split("|", 1)])
            else:
                fields[m.group(1)] = m.group(2).strip()
        elif line.startswith("## "):
            current = {"heading": line[3:].strip(), "lines": []}
            sections.append(current)
        elif current is not None:
            current["lines"].append(line)
    return {"fields": fields, "related": related, "sections": sections}


def faq_pairs(lines):
    """[(question, answer)] from "Q: ..." / "A: ..." lines. An answer may run on over several lines."""
    pairs, q, a = [], None, None
    for raw in lines + ["Q:"]:
        s = raw.strip()
        if s.startswith("Q:"):
            if q is not None:
                pairs.append((q, " ".join(a or [])))
            q, a = (s[2:].strip() or None), None
        elif s.startswith("A:") and q is not None:
            a = [s[2:].strip()]
        elif s and a is not None:
            a.append(s)
    return [(q, a) for q, a in pairs if q]


def is_draft(fields):
    return fields.get("Draft", "yes").strip().lower() != "no"


def check(text, pages, anchors, taken):
    """Every rule a question page must pass. taken: [(url, keyword)] of every page that owns a keyword."""
    p = parse(text)
    f, bad = p["fields"], []
    for name in FIELDS:
        if not f.get(name):
            bad.append(f"Missing {name}:")
    if bad:
        return bad
    url = f["URL"]
    if not re.match(r"^/questions/[a-z0-9]+(?:-[a-z0-9]+)*/$", url):
        bad.append(f"URL must look like /questions/some-question/, not {url}")
    if f["Draft"].lower() not in ("yes", "no"):
        bad.append("Draft: must be yes or no.")
    title = f["Title"] + SUFFIX
    if len(title) > blogpost.MAX_TITLE:
        bad.append(f"The title is {len(title)} characters with the suffix; keep it to {blogpost.MAX_TITLE}.")
    lo, hi = blogpost.DESCRIPTION
    if not lo <= len(f["Description"]) <= hi:
        bad.append(f"The description is {len(f['Description'])} characters; it should be {lo} to {hi}.")
    if not f["Question"].endswith("?"):
        bad.append("Question: should be the question itself, ending with a question mark.")
    kw = f["Keyword"].lower()
    for other_url, other in taken:
        if other_url != url and blogpost.too_close(kw, other):
            bad.append(f'The keyword "{kw}" competes with {other_url} ("{other}").')
    if f["Offer"] not in OFFERS:
        bad.append(f"Offer: must be one of {', '.join(OFFERS)}.")
    heads = [s["heading"] for s in p["sections"]]
    if not heads or heads[0] != ANSWER:
        bad.append(f"The first section must be ## {ANSWER}.")
    else:
        answer = [b for b in problems.blocks(p["sections"][0]["lines"]) if b[0] == "p"]
        if not answer:
            bad.append(f"## {ANSWER} needs at least one paragraph.")
    faq = next((s for s in p["sections"] if s["heading"] == FAQ), None)
    if faq is None:
        bad.append(f"Needs a ## {FAQ} section.")
    elif len(faq_pairs(faq["lines"])) < MIN_FAQ:
        bad.append(f"## {FAQ} needs at least {MIN_FAQ} Q:/A: pairs; it has {len(faq_pairs(faq['lines']))}.")
    elif any(not a for _, a in faq_pairs(faq["lines"])):
        bad.append(f"Every Q: in ## {FAQ} needs an A: line.")
    source = source_url(f)
    if f.get("Source") and not blogpost.SOURCE.match(source):
        bad.append("Source: must be a full https:// address, then | and the link text.")
    links = [u for _, u in blogpost.LINK.findall(text) if not (source and u == source)] + [r[0] for r in p["related"]]
    for link in links:
        target = link.split("#")[0] or "/"
        if not link.startswith("/") or link.startswith("//"):
            bad.append(f"Links must go to our own pages; this one doesn't: {link}")
        elif link.startswith("/#") and link[2:] not in anchors:
            bad.append(f"There's no {link} section on the home page.")
        elif target.split("?")[0] not in pages:
            bad.append(f"There's no page at {link}.")
    prose = "\n".join(line for line in text.splitlines()
                      if not re.match(r"^(URL|Keyword|Draft|Offer|Related|Source):", line))
    if REGION.lower() not in prose.lower():
        bad.append(f"Mention {REGION} somewhere in the page text.")
    if not any(t.lower() in prose.lower() for t in LOCAL_TOWNS):
        bad.append(f"Mention at least one nearby place: {', '.join(LOCAL_TOWNS)}.")
    bad += problems.copy_rules(prose)
    return list(dict.fromkeys(bad))


def source_url(fields):
    return fields.get("Source", "").split("|")[0].strip()


def plain(text):
    """Visible text of an inline-formatted line, for schema."""
    return html.unescape(re.sub(r"<[^>]+>", "", blogpost.inline(text)))


def schema(p, site):
    f, url = p["fields"], p["fields"]["URL"]
    answer = " ".join(v for k, v in problems.blocks(p["sections"][0]["lines"]) if k == "p")
    faq = next(s for s in p["sections"] if s["heading"] == FAQ)
    questions = [(f["Question"], answer)] + faq_pairs(faq["lines"])
    graph = [
        {"@type": ["WebPage", "FAQPage"], "@id": f"{site}{url}#page", "url": f"{site}{url}", "name": f["Title"],
         "description": f["Description"], "inLanguage": "en-US", "isPartOf": {"@id": f"{site}/#website"},
         "publisher": {"@id": f"{site}/#organization"}, "about": {"@id": f"{site}/#organization"},
         "mainEntity": [{"@type": "Question", "name": plain(q), "acceptedAnswer": {"@type": "Answer", "text": plain(a)}}
                        for q, a in questions]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
            {"@type": "ListItem", "position": 2, "name": "FAQ", "item": f"{site}/faq/"},
            {"@type": "ListItem", "position": 3, "name": f["Crumb"], "item": f"{site}{url}"}]},
    ]
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)


def page_html(text, site, brand, phone="", tel=""):
    """The whole page, with empty shared blocks for sync to fill."""
    p = parse(text)
    f = p["fields"]
    url, slug = f["URL"], f["URL"].strip("/").split("/")[-1]
    t, d = html.escape(f["Title"] + SUFFIX), html.escape(f["Description"])
    robots = '\n<meta name="robots" content="noindex, follow">' if is_draft(f) else ""
    i8 = " " * 8
    src = source_url(f)
    src_label = (f.get("Source", "").split("|", 1) + [""])[1].strip() or "Source"
    answer = p["sections"][0]
    answer_html = problems.section_html(answer["lines"], i8)
    source_html = (f'\n{i8}<p class="source-line">Source: <a class="text-link" href="{html.escape(src)}" target="_blank" rel="noopener">'
                   f'{html.escape(src_label)}</a></p>') if src else ""
    body = [s for s in p["sections"][1:] if s["heading"] != FAQ]
    faq = next(s for s in p["sections"] if s["heading"] == FAQ)
    sections = "\n\n".join(f'{i8}<h2>{blogpost.inline(s["heading"])}</h2>\n{problems.section_html(s["lines"], i8)}' for s in body)
    faq_items = "\n".join(f'{i8}  <details>\n{i8}    <summary>{blogpost.inline(q)}</summary>\n{i8}    <p>{blogpost.inline(a)}</p>\n{i8}  </details>'
                          for q, a in faq_pairs(faq["lines"]))
    o_head, o_text, o_label, o_href = OFFERS[f["Offer"]]
    call = (f'<a class="btn" href="tel:{tel}">Call {html.escape(phone)}</a>' if phone else "")
    call_aside = (f'\n          <a class="btn" href="tel:{tel}">Call {html.escape(phone)}</a>' if phone else "")
    related = "\n".join(f'            <li><a href="{html.escape(u)}">{html.escape(label)}</a></li>' for u, label in p["related"])
    related = related or '            <li><a href="/faq/">More common questions</a></li>'
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- Built by `site.py questions` from scripts/questions/{slug}.txt. Edit that file, not this page. -->
<!-- shared:head --><!-- /shared:head -->
<title>{t}</title>
<meta name="description" content="{d}">{robots}
<link rel="canonical" href="{site}{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{html.escape(brand)}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{site}{url}">
<script type="application/ld+json">
{schema(p, site)}
</script>
</head>
<body>
<!-- shared:header --><!-- /shared:header -->

<main id="main" class="question-page">
  <section class="page-hero">
    <div class="wrap">
      <p class="crumbs"><a href="/">Home</a> / <a href="/faq/">FAQ</a> / {html.escape(f["Crumb"])}</p>
      <h1>{html.escape(f["Question"], quote=False)}</h1>
    </div>
  </section>

  <div class="page-body">
    <div class="wrap page-grid">
      <article class="prose">
        <div class="summary tldr">
          <p class="eyebrow">TL;DR</p>
          <p>{blogpost.inline(f["TLDR"])}</p>
        </div>

        <h2 id="answer">{html.escape(ANSWER)}</h2>
{answer_html}{source_html}

{sections}

        <h2 id="faq">{html.escape(FAQ)}</h2>
        <div class="faq">
{faq_items}
        </div>

        <div class="cta-band">
          <h2>Want a straight answer for your business?</h2>
          <p>{html.escape(o_text)} We work with businesses in Cherry Hill, across South Jersey and in Philadelphia.</p>
          <div class="cta-actions">
            {call}
            <a class="btn{' btn-ghost' if phone else ''}" href="{o_href}">{html.escape(o_label)} {ARROW}</a>
          </div>
        </div>
      </article>

      <aside class="aside" aria-label="More from {html.escape(brand)}">
        <div class="aside-card">
          <h2>{html.escape(o_head)}</h2>
          <p>{html.escape(o_text)}</p>{call_aside}
          <a class="btn{' btn-ghost' if phone else ''}" href="{o_href}">{html.escape(o_label)}</a>
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
