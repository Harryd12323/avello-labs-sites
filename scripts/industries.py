"""Industry pages: one landing page per kind of local business we want to work with (dentists, HVAC, law firms...).
Each covers the real problems that business has online, what we do about them, and the monthly plan, with a short
FAQ (FAQPage schema), Service schema and links to the other industry pages. Built by `site.py industries` from the
text files in scripts/industries/; sync then fills in the shared head, header, footer, the plans block and the list
of other industries.

No results, reviews or client names unless they're real and the client said yes (docs/humanizer.md).

Text format (fields first, then sections):
    URL: /industries/some-business/     (always under /industries/)
    Industry: Dentists                  (plural, as it reads in a list: "Dentists", "HVAC companies")
    Crumb: Dentists
    Title: ...                          (without " | Avello Labs"; the whole title at most 62 characters)
    Description: ...                    (120 to 160 characters)
    Keyword: ...                        (the search the page is written for; must not compete with other pages)
    Headline: ... with *gradient words*
    Lede: One or two sentences under the headline.
    Order: 1                            (position in lists)
    Related: /path/ | Link text         (blog posts, question pages, service pages; any number)
    ## What gets in the way             (first section: their real problems online, 3 or more "- " bullets)
    ## What we do about it              (second section: what we do, benefit first)
    ## Any other section heading        (a month on the plan, rules for their trade, and so on)
    ## Common questions                 then "Q: ..." / "A: ..." pairs (at least 3)
"""
import html
import json
import re

import blogpost
import problems
import questions

FIELDS = ["URL", "Industry", "Crumb", "Title", "Description", "Keyword", "Headline", "Lede", "Order"]
FIRST = "What gets in the way"
SECOND = "What we do about it"
FAQ = questions.FAQ
MIN_FAQ = 3
SUFFIX = blogpost.SUFFIX
ARROW = blogpost.ARROW


def parse(text):
    fields, related, sections, current = {}, [], [], None
    for raw in text.splitlines():
        line = raw.rstrip()
        m = re.match(r"^([A-Z][A-Za-z-]*): ?(.*)$", line)
        if current is None and m and (m.group(1) in FIELDS or m.group(1) == "Related"):
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


def check(text, pages, anchors, taken):
    p = parse(text)
    f, bad = p["fields"], []
    for name in FIELDS:
        if not f.get(name):
            bad.append(f"Missing {name}:")
    if bad:
        return bad
    url = f["URL"]
    if not re.match(r"^/industries/[a-z0-9]+(?:-[a-z0-9]+)*/$", url):
        bad.append(f"URL must look like /industries/some-business/, not {url}")
    if not f["Order"].isdigit():
        bad.append("Order: must be a number.")
    title = f["Title"] + SUFFIX
    if len(title) > blogpost.MAX_TITLE:
        bad.append(f"The title is {len(title)} characters with the suffix; keep it to {blogpost.MAX_TITLE}.")
    lo, hi = blogpost.DESCRIPTION
    if not lo <= len(f["Description"]) <= hi:
        bad.append(f"The description is {len(f['Description'])} characters; it should be {lo} to {hi}.")
    kw = f["Keyword"].lower()
    for other_url, other in taken:
        if other_url != url and blogpost.too_close(kw, other):
            bad.append(f'The keyword "{kw}" competes with {other_url} ("{other}").')
    heads = [s["heading"] for s in p["sections"]]
    if heads[:2] != [FIRST, SECOND]:
        bad.append(f"The first two sections must be ## {FIRST} and ## {SECOND}.")
    elif len([i for k, v in problems.blocks(p["sections"][0]["lines"]) if k == "ul" for i in v]) < 3:
        bad.append(f"## {FIRST} needs at least 3 \"- \" bullets (their real problems).")
    faq = next((s for s in p["sections"] if s["heading"] == FAQ), None)
    if faq is None:
        bad.append(f"Needs a ## {FAQ} section.")
    else:
        pairs = questions.faq_pairs(faq["lines"])
        if len(pairs) < MIN_FAQ:
            bad.append(f"## {FAQ} needs at least {MIN_FAQ} Q:/A: pairs; it has {len(pairs)}.")
        elif any(not a for _, a in pairs):
            bad.append(f"Every Q: in ## {FAQ} needs an A: line.")
    links = [u for _, u in blogpost.LINK.findall(text)] + [r[0] for r in p["related"]]
    for link in links:
        target = link.split("#")[0] or "/"
        if not link.startswith("/") or link.startswith("//"):
            bad.append(f"Links must go to our own pages; this one doesn't: {link}")
        elif link.startswith("/#") and link[2:] not in anchors:
            bad.append(f"There's no {link} section on the home page.")
        elif target.split("?")[0] not in pages:
            bad.append(f"There's no page at {link}.")
    prose = "\n".join(line for line in text.splitlines() if not re.match(r"^(URL|Keyword|Order|Related):", line))
    if "south jersey" not in prose.lower():
        bad.append("Mention South Jersey somewhere in the page text.")
    bad += problems.copy_rules(prose)
    return list(dict.fromkeys(bad))


def schema(p, site):
    f, url = p["fields"], p["fields"]["URL"]
    faq = next(s for s in p["sections"] if s["heading"] == FAQ)
    graph = [
        {"@type": "WebPage", "@id": f"{site}{url}#page", "url": f"{site}{url}", "name": f["Title"], "description": f["Description"],
         "inLanguage": "en-US", "isPartOf": {"@id": f"{site}/#website"}, "publisher": {"@id": f"{site}/#organization"},
         "mainEntity": {"@id": f"{site}{url}#service"}},
        {"@type": "Service", "@id": f"{site}{url}#service", "name": f"Websites, monthly care and local SEO for {f['Industry'].lower()}",
         "serviceType": "Website design, monthly website care and local SEO", "provider": {"@id": f"{site}/#organization"},
         "audience": {"@type": "BusinessAudience", "audienceType": f["Industry"]},
         "areaServed": [{"@type": "Place", "name": "South Jersey"}, {"@type": "City", "name": "Philadelphia, PA"}],
         "url": f"{site}{url}"},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": questions.plain(q), "acceptedAnswer": {"@type": "Answer", "text": questions.plain(a)}}
                                           for q, a in questions.faq_pairs(faq["lines"])]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{site}/"},
            {"@type": "ListItem", "position": 2, "name": "Who we help", "item": f"{site}/industries/"},
            {"@type": "ListItem", "position": 3, "name": f["Crumb"], "item": f"{site}{url}"}]},
    ]
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, indent=2, ensure_ascii=False)


def page_html(text, site, brand, hide=()):
    """The whole page, with empty shared blocks for sync to fill. Links to the paths in hide (draft pages) are left
    out: a Related link is dropped and a link in the text becomes plain words, until that page is published."""
    text = blogpost.LINK.sub(lambda m: m.group(1) if m.group(2).split("#")[0] in hide else m.group(0), text)
    p = parse(text)
    p["related"] = [r for r in p["related"] if r[0].split("#")[0] not in hide]
    f = p["fields"]
    url, slug = f["URL"], f["URL"].strip("/").split("/")[-1]
    t, d = html.escape(f["Title"] + SUFFIX), html.escape(f["Description"])
    i8 = " " * 8
    body = [s for s in p["sections"] if s["heading"] != FAQ]
    faq = next(s for s in p["sections"] if s["heading"] == FAQ)
    sections = "\n\n".join(f'{i8}<h2>{blogpost.inline(s["heading"])}</h2>\n{problems.section_html(s["lines"], i8)}' for s in body)
    faq_items = "\n".join(f'{i8}  <details>\n{i8}    <summary>{blogpost.inline(q)}</summary>\n{i8}    <p>{blogpost.inline(a)}</p>\n{i8}  </details>'
                          for q, a in questions.faq_pairs(faq["lines"]))
    related = "\n".join(f'            <li><a href="{html.escape(u)}">{html.escape(label)}</a></li>' for u, label in p["related"])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<!-- Built by `site.py industries` from scripts/industries/{slug}.txt. Edit that file, not this page. -->
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
{schema(p, site)}
</script>
</head>
<body>
<!-- shared:header --><!-- /shared:header -->

<main id="main" class="industry-page">
  <section class="page-hero">
    <div class="wrap">
      <p class="crumbs"><a href="/">Home</a> / <a href="/industries/">Who we help</a> / {html.escape(f["Crumb"])}</p>
      <h1>{problems.headline_html(f["Headline"])}</h1>
      <p class="lede">{blogpost.inline(f["Lede"])}</p>
      <div class="hero-actions">
        <a class="btn" href="/#contact">Get my free review {ARROW}</a>
        <a class="btn btn-ghost" href="/check/">Free site check</a>
      </div>
    </div>
  </section>

  <div class="page-body">
    <div class="wrap page-grid">
      <article class="prose">
{sections}

        <h2 id="plans">Your monthly plan</h2>
        <!-- shared:plans-summary --><!-- /shared:plans-summary -->

        <h2 id="faq">{html.escape(FAQ)}</h2>
        <div class="faq">
{faq_items}
        </div>

        <!-- shared:promise --><!-- /shared:promise -->

        <div class="cta-band">
          <h2>See what we'd fix first</h2>
          <p>A free 20-minute call. We look at your website, your Google Business Profile and what AI tools say about you, then walk you through the 3 fixes we'd make first. No obligation.</p>
          <div class="cta-actions">
            <!-- shared:call-btn --><!-- /shared:call-btn -->
            <a class="btn btn-ghost" href="/#contact">Get my free review {ARROW}</a>
          </div>
        </div>
      </article>

      <aside class="aside" aria-label="More from {html.escape(brand)}">
        <div class="aside-card">
          <h2>Free site check</h2>
          <p>See what's stopping people from finding you on Google and in AI answers. Takes a few seconds.</p>
          <a class="btn" href="/check/">Check my site</a>
        </div>
        <div class="aside-card">
          <h2>What's your website costing you?</h2>
          <p>Put in your own numbers and see what one more customer a month is worth.</p>
          <a class="btn btn-ghost" href="/tools/website-cost-calculator/">Open the calculator</a>
        </div>
        <div class="aside-card">
          <h2>Read more</h2>
          <ul>
{related}
          </ul>
        </div>
        <div class="aside-card">
          <h2>Other businesses we help</h2>
          <!-- shared:industry-links --><!-- /shared:industry-links -->
        </div>
      </aside>
    </div>
  </div>
</main>

<!-- shared:footer --><!-- /shared:footer -->
</body>
</html>
"""
