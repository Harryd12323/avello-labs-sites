"""Blog posts written as plain text: the format the blog agent drafts in and the owner edits on the card, turned
into the HTML of a post page, plus every rule a post has to pass before it can be published.

The format (one header line each, then the body):

    Title: How to Get Your Business Recommended by ChatGPT
    Headline: How to get your business recommended by ChatGPT
    Description: One or two sentences for search results, 120 to 160 characters.
    Keyword: how to get my business recommended by chatgpt
    Slug: get-business-recommended-by-chatgpt
    Service page: /aeo/
    Lede: One or two sentences under the headline.

    In short:
    - Two to four points.

    ## A heading
    A paragraph, with **bold**, `code` and [links to our own pages](/check/).

    - a bullet list
    1. or a numbered one

    ### A smaller heading

    ## Common questions
    Q: A question someone would ask?
    A: The answer, in one to four sentences.

    Call to action: Heading | One or two sentences | Button label | /check/ (or "chat")

A news post (owner-approved 2026-11-02) adds two header lines and is shorter: 250 to 600 words, at least two
sections, and "Common questions" is optional (up to 3). It shows a "News" label on the blog.

    Type: news
    Source: https://www.example.com/the-original-story/

Its body must link the Source (the only outside link a post may have), it paraphrases the story, and it quotes at most
one passage, under 15 words. Quoted text under 5 words counts as a term ("AI Mode"), not a quote.
A news post's keyword is checked against the pages that own one, but it never owns it itself, so it can't block a
later regular post (scripts/site.py taken_keywords).

Used by scripts/site.py (import-post, check-post). Python 3 stdlib only.
"""
import html
import math
import re

HEADERS = ["Title", "Headline", "Description", "Keyword", "Slug", "Service page", "Lede"]
OPTIONAL = ["Type", "Source"]  # news posts only
FAQ_HEADING = "Common questions"
SUFFIX = " | Avello Labs"
ARROW = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>')
CHAT_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
             'stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>')

# Limits a post has to fit
MAX_TITLE = 62               # the whole <title>, " | Avello Labs" included
DESCRIPTION = (120, 160)
MAX_HEADLINE = 110           # Google's limit for an Article headline
WORDS = (700, 1700)
FAQ_COUNT = (3, 5)
SUMMARY_POINTS = (2, 4)
MIN_SECTIONS = 3             # ## headings, the FAQ included
NEWS_WORDS = (250, 600)
NEWS_FAQ_COUNT = (0, 3)
NEWS_MIN_SECTIONS = 2
MAX_QUOTES = 1               # news posts: quoted passages from the source
MAX_QUOTE_WORDS = 14         # "under 15 words"
QUOTE_MIN_WORDS = 5          # shorter quoted text is a term, not a quote
WORDS_PER_MINUTE = 230       # the same as scripts/site.py

# Copy rules (the site's own, plus the blog's): no dashes as punctuation, nothing AI-sounding, no invented numbers,
# no promises, and never the towns the owner lives near.
DASHES = re.compile("[" + chr(0x2014) + chr(0x2013) + r"]|(?<=\S)[ \t]+-{1,2}[ \t]+")
BANNED = ["seamless", "seamlessly", "elevate", "plain english", "leverage", "unlock", "robust", "delve",
          "in today's", "digital landscape", "digital world", "ever-evolving", "game-changer", "game changer",
          "cutting-edge", "world-class", "state-of-the-art", "our team", "the team", "tailored", "harness",
          "empower", "look no further", "rest assured", "in conclusion", "dive in", "deep dive", "unleash",
          "supercharge", "skyrocket", "next level", "next-level", "it's not just", "isn't just", "not just about",
          "navigate the", "the world of", "embark", "journey", "treasure trove", "testament to"]
BLOCKED_PLACES = ["Haddon Township", "Collingswood", "Haddonfield"]
STATS = re.compile(r"\d\s*%|\bpercent\b|\bstudies (?:show|found)|\bresearch (?:shows|found)|\bsurveys? (?:show|found)|"
                   r"\baccording to (?:a|one|recent) (?:study|survey|report)|\bstatistic|\bon average\b|"
                   r"\b\d+ (?:out )?of (?:every )?\d+\b|\$\s?\d", re.I)
PROMISE = re.compile(r"\b(?:guarantee[sd]?|guaranteed)\b|\b(?:number one|#1|first page) (?:on|of|in) google\b|"
                     r"\bwill (?:rank|always|definitely|certainly)\b|\bovernight\b", re.I)
NEGATED = re.compile(r"\b(?:no|not|never|nobody|no one|can't|cannot|won't|isn't|doesn't)\b[^.?!]{0,40}$", re.I)
LINK = re.compile(r"\[([^\]\n]+)\]\(([^)\s]+)\)")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
QUOTE = re.compile("\u201c([^\u201d\n]+)\u201d|\"([^\"\n]+)\"")
SOURCE = re.compile(r"^https://[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]\S*)?$", re.I)
NOT_SOURCES = ("avellolabs.com", "news.google.com")
STOPWORDS = {"a", "an", "and", "the", "to", "for", "of", "in", "on", "my", "your", "is", "do", "i", "how", "what",
             "why", "does", "can", "should", "with", "it", "be", "are", "or", "vs", "if"}


class PostError(Exception):
    """The text isn't in the post format at all (so it can't be checked or built)."""


def parse(text):
    """{"fields": {header: value}, "blocks": [...]} from the post text. Raises PostError if it can't be read."""
    lines = text.replace("\r\n", "\n").split("\n")
    fields, i = {}, 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    while i < len(lines):
        m = re.match(r"^(" + "|".join(HEADERS + OPTIONAL) + r"):\s*(.*)$", lines[i])
        if not m:
            break
        fields[m.group(1)] = m.group(2).strip()
        i += 1
    if not fields:
        raise PostError("The post has to start with its header lines (Title:, Headline:, Description: ...).")

    blocks, para = [], []

    def flush():
        if para:
            blocks.append(("p", " ".join(s.strip() for s in para)))
            para.clear()

    rest = lines[i:]
    j = 0
    while j < len(rest):
        line = rest[j].rstrip()
        s = line.strip()
        if not s:
            flush()
        elif s == "In short:":
            flush()
            points = []
            while j + 1 < len(rest) and rest[j + 1].strip().startswith("- "):
                j += 1
                points.append(rest[j].strip()[2:].strip())
            blocks.append(("summary", points))
        elif s.startswith("### "):
            flush()
            blocks.append(("h3", s[4:].strip()))
        elif s.startswith("## "):
            flush()
            blocks.append(("h2", s[3:].strip()))
        elif s.startswith("- ") or re.match(r"^\d+\.\s", s):
            flush()
            kind = "ul" if s.startswith("- ") else "ol"
            items = []
            while j < len(rest):
                t = rest[j].strip()
                if kind == "ul" and t.startswith("- "):
                    items.append(t[2:].strip())
                elif kind == "ol" and re.match(r"^\d+\.\s", t):
                    items.append(re.sub(r"^\d+\.\s+", "", t))
                elif t and items and not re.match(r"^(- |\d+\.\s|#|Q:|A:|Call to action:)", t):
                    items[-1] += " " + t          # a long item that wrapped onto the next line
                else:
                    break
                j += 1
            blocks.append((kind, items))
            continue
        elif s.startswith("Q:"):
            flush()
            q, a = s[2:].strip(), []
            while j + 1 < len(rest) and rest[j + 1].strip() and not rest[j + 1].strip().startswith("Q:"):
                j += 1
                t = rest[j].strip()
                a.append(t[2:].strip() if t.startswith("A:") and not a else t)
            blocks.append(("qa", (q, " ".join(a))))
        elif s.startswith("Call to action:"):
            flush()
            parts = [p.strip() for p in s[len("Call to action:"):].split("|")]
            blocks.append(("cta", parts))
        else:
            para.append(s)
        j += 1
    flush()
    return {"fields": fields, "blocks": blocks}


def is_news(fields):
    return fields.get("Type", "").strip().lower() == "news"


def source_of(fields):
    """A news post's Source URL ('' for any other post)."""
    return fields.get("Source", "").strip() if is_news(fields) else ""


# ---------- turning it into HTML ----------

def inline(text, source=""):
    """Escaped text with **bold**, `code` and [links](/path/) (our own pages only, plus a news post's `source`;
    anything else stays plain text)."""
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)

    def link(m):
        label, url = m.group(1), html.unescape(m.group(2))
        if source and url == source:
            return f'<a href="{html.escape(url)}" rel="noopener">{label}</a>'
        if not url.startswith("/") or url.startswith("//"):
            return label
        return f'<a href="{html.escape(url)}">{label}</a>'
    return LINK.sub(link, out)


def body_html(post, indent="        "):
    """The <article> contents: summary box, sections, FAQ and the call to action."""
    out, faq = [], []
    source = source_of(post["fields"])

    def fmt(text):
        return inline(text, source)

    def close_faq():
        if faq:
            items = "\n".join(f"{indent}  <details>\n{indent}    <summary>{fmt(q)}</summary>\n"
                              f"{indent}    <p>{fmt(a)}</p>\n{indent}  </details>" for q, a in faq)
            out.append(f'{indent}<div class="faq">\n{items}\n{indent}</div>')
            faq.clear()

    for kind, value in post["blocks"]:
        if kind != "qa":
            close_faq()
        if kind == "summary":
            points = "\n".join(f"{indent}    <li>{fmt(p)}</li>" for p in value)
            out.append(f'{indent}<div class="summary">\n{indent}  <p class="eyebrow">In short</p>\n'
                       f"{indent}  <ul>\n{points}\n{indent}  </ul>\n{indent}</div>")
        elif kind == "h2":
            anchor = ' id="faq"' if value == FAQ_HEADING else ""
            out.append(f"\n{indent}<h2{anchor}>{fmt(value)}</h2>")
        elif kind == "h3":
            out.append(f"{indent}<h3>{fmt(value)}</h3>")
        elif kind == "p":
            out.append(f"{indent}<p>{fmt(value)}</p>")
        elif kind in ("ul", "ol"):
            items = "\n".join(f"{indent}  <li>{fmt(i)}</li>" for i in value)
            out.append(f"{indent}<{kind}>\n{items}\n{indent}</{kind}>")
        elif kind == "qa":
            faq.append(value)
        elif kind == "cta":
            heading, text, label, target = (value + ["", "", "", ""])[:4]
            if target.lower() == "chat":
                button = f'<a class="btn" href="#" data-open-chat>{CHAT_ICON}{fmt(label)}</a>'
            else:
                button = f'<a class="btn" href="{html.escape(target)}">{fmt(label)} {ARROW}</a>'
            out.append(f'\n{indent}<div class="cta-band">\n{indent}  <h2>{fmt(heading)}</h2>\n'
                       f"{indent}  <p>{fmt(text)}</p>\n{indent}  {button}\n{indent}</div>")
    close_faq()
    return "\n".join(out).lstrip("\n")


# ---------- the rules ----------

def plain_words(post):
    """The body's readable text (what the reading time counts), without the call to action."""
    parts = []
    for kind, value in post["blocks"]:
        if kind in ("p", "h2", "h3"):
            parts.append(value)
        elif kind in ("ul", "ol", "summary"):
            parts.extend(value)
        elif kind == "qa":
            parts.extend(value)
    text = LINK.sub(r"\1", " ".join(parts)).replace("**", "").replace("`", "")
    return re.findall(r"[\w’']+", text)


def keyword_words(keyword):
    return {w for w in re.findall(r"[a-z0-9]+", keyword.lower()) if w not in STOPWORDS}


# Where a business is doesn't make two topics different or the same: "dentist website south jersey" and "restaurant
# website south jersey" don't compete, "contractor website camden county" and "contractor website south jersey" do.
PLACE_WORDS = {"south", "jersey", "nj", "new", "camden", "burlington", "gloucester", "county", "counties",
               "philadelphia", "philly", "local", "near", "me"}


def too_close(a, b):
    """True if two target keywords would compete with each other (most of their meaningful words are shared)."""
    wa, wb = keyword_words(a) - PLACE_WORDS, keyword_words(b) - PLACE_WORDS
    if not wa or not wb:
        return False
    small, large = sorted((wa, wb), key=len)
    inside = small <= large and 2 * len(small) >= len(large)    # one inside the other, and at least half of it
    return inside or len(wa & wb) / len(wa | wb) >= 0.6         # ...or mostly the same words


def covers(text, keyword, share=0.75):
    """True if `text` contains most of the keyword's meaningful words (word forms like show/showing count)."""
    words = keyword_words(keyword)
    have = set(re.findall(r"[a-z0-9]+", text.lower()))
    found = sum(1 for w in words if any(h == w or h.startswith(w[:5]) for h in have))
    return not words or found / len(words) >= share


def check(text, pages=(), anchors=(), taken=()):
    """Every problem with the post (empty list: it's ready). `pages`: our pages' URL paths a link may point to;
    `anchors`: allowed "/#id" links; `taken`: [(url, keyword)] of pages that already own a keyword."""
    try:
        post = parse(text)
    except PostError as e:
        return [str(e)]
    f, blocks, problems = post["fields"], post["blocks"], []
    for name in HEADERS:
        if not f.get(name):
            problems.append(f'Missing the "{name}:" line.')
    news, source = is_news(f), source_of(f)
    if "Type" in f and not news:
        problems.append('The only "Type:" a post can have is "news".')
    if f.get("Source") and not news:
        problems.append('Only a news post ("Type: news") has a "Source:" line.')
    if news:
        host = re.sub(r"^https://([^/?#]+).*$", r"\1", source).lower()
        if not source:
            problems.append('A news post needs a "Source:" line with the original story\'s address.')
        elif not SOURCE.match(source):
            problems.append("The source must be the original story's full https:// address.")
        elif any(host == bad or host.endswith("." + bad) for bad in NOT_SOURCES):
            problems.append(f"The source must be the original story, not {host}.")
    title, headline, desc = f.get("Title", ""), f.get("Headline", ""), f.get("Description", "")
    keyword, slug, service = f.get("Keyword", "").lower(), f.get("Slug", ""), f.get("Service page", "")
    if title and len(title + SUFFIX) > MAX_TITLE:
        problems.append(f"The title is {len(title + SUFFIX)} characters with \"{SUFFIX.strip()}\" added; "
                        f"keep it to {MAX_TITLE} so Google doesn't cut it off.")
    if headline and len(headline) > MAX_HEADLINE:
        problems.append(f"The headline is {len(headline)} characters; keep it under {MAX_HEADLINE}.")
    if desc and not DESCRIPTION[0] <= len(desc) <= DESCRIPTION[1]:
        problems.append(f"The description is {len(desc)} characters; it should be {DESCRIPTION[0]} to "
                        f"{DESCRIPTION[1]}.")
    if slug and not SLUG.match(slug):
        problems.append("The slug can only have lowercase letters, numbers and single dashes.")
    if keyword:
        if not covers(title + " " + headline, keyword):
            problems.append(f'The keyword "{keyword}" isn\'t in the title or headline.')
        if desc and not covers(desc, keyword, 0.5):
            problems.append(f'The description doesn\'t mention the keyword "{keyword}".')
        first = next((v for k, v in blocks if k == "p"), "")
        if not covers(f.get("Lede", "") + " " + first, keyword, 0.5):
            problems.append(f'The lede and first paragraph don\'t mention the keyword "{keyword}".')
        for url, other in taken:
            if url != f"/blog/{slug}/" and too_close(keyword, other):
                problems.append(f'The keyword "{keyword}" competes with {url} ("{other}"). Pick a different one.')

    words, limits = plain_words(post), NEWS_WORDS if news else WORDS
    if not limits[0] <= len(words) <= limits[1]:
        problems.append(f"The post is {len(words)} words; it should be {limits[0]} to {limits[1]}.")
    summary = [v for k, v in blocks if k == "summary"]
    if not summary:
        problems.append('Missing the "In short:" list at the top.')
    elif not SUMMARY_POINTS[0] <= len(summary[0]) <= SUMMARY_POINTS[1]:
        problems.append(f'"In short:" should have {SUMMARY_POINTS[0]} to {SUMMARY_POINTS[1]} points.')
    h2s = [v for k, v in blocks if k == "h2"]
    sections = NEWS_MIN_SECTIONS if news else MIN_SECTIONS
    if len(h2s) < sections:
        problems.append(f"The post needs at least {sections} sections (## headings).")
    faq, count = [v for k, v in blocks if k == "qa"], NEWS_FAQ_COUNT if news else FAQ_COUNT
    if FAQ_HEADING not in h2s and (faq or not news):
        problems.append(f'Missing the "## {FAQ_HEADING}" section.')
    if not count[0] <= len(faq) <= count[1]:
        problems.append(f"The FAQ has {len(faq)} questions; it should have {count[0]} to {count[1]}.")
    for q, a in faq:
        if not q.endswith("?"):
            problems.append(f'FAQ question doesn\'t end with "?": {q[:60]}')
        if not a:
            problems.append(f"FAQ question has no answer: {q[:60]}")
    ctas = [v for k, v in blocks if k == "cta"]
    if not ctas:
        problems.append('Missing the "Call to action:" line at the end.')
    else:
        parts = ctas[-1]
        if len(parts) != 4 or not all(parts):
            problems.append('The call to action needs four parts: Heading | Text | Button label | /check/ or chat.')
        elif parts[3].lower() not in ("/check/", "chat"):
            problems.append('The call to action should point to /check/ or the chat ("chat").')
        if blocks[-1][0] != "cta":
            problems.append("The call to action should be the last thing in the post.")

    links = [m.group(2) for m in LINK.finditer(text)]
    if "/check/" not in links:
        problems.append("The post doesn't link to the free site check (/check/).")
    if service and service not in links:
        problems.append(f"The post doesn't link to its service page ({service}).")
    if source and SOURCE.match(source) and source not in links:
        problems.append(f"A news post must link the original story ({source}) in its text.")
    for url in links:
        if source and url == source:
            continue
        if not url.startswith("/") or url.startswith("//"):
            problems.append(f"Links must go to our own pages; this one doesn't: {url}")
        elif url.startswith("/#"):
            if url[2:] not in anchors:
                problems.append(f"There's no {url} section on the home page.")
        elif pages and url not in pages:
            problems.append(f"There's no page at {url}.")
    if service and pages and service not in pages:
        problems.append(f"The service page {service} doesn't exist.")

    body = text.split("\n")
    prose = "\n".join(line for line in body if not re.match(r"^(Slug|Keyword|Service page|Type|Source):", line))
    if DASHES.search(prose):
        problems.append("Uses an em dash, en dash or a spaced hyphen as punctuation. Use a period or comma.")
    low = prose.lower()
    for word in BANNED:
        if re.search(r"(?<![\w-])" + re.escape(word) + r"(?![\w-])", low):
            problems.append(f'Uses "{word}", which the copy rules don\'t allow.')
    for place in BLOCKED_PLACES:
        if place.lower() in low:
            problems.append(f'Names {place}. Use the county or "South Jersey" instead.')
    for m in STATS.finditer(prose):
        problems.append(f'Looks like a statistic or price ("{m.group(0).strip()}"). No numbers we can\'t back up.')
    for m in PROMISE.finditer(prose):
        if not NEGATED.search(prose[:m.start()].split("\n")[-1]):
            problems.append(f'Sounds like a promise ("{m.group(0)}").')
    if news:
        quotes = [q for q in (a or b for a, b in QUOTE.findall(prose)) if len(q.split()) >= QUOTE_MIN_WORDS]
        if len(quotes) > MAX_QUOTES:
            problems.append(f"Quotes the source {len(quotes)} times; a news post may quote it once at most. "
                            "Put the rest in our own words.")
        for q in quotes:
            if len(q.split()) > MAX_QUOTE_WORDS:
                problems.append(f'The quote "{q[:50]}..." is {len(q.split())} words; keep a quote under 15 words.')
    return list(dict.fromkeys(problems))


def stats(text):
    """{"words", "minutes"} for a post that parses."""
    words = len(plain_words(parse(text)))
    return {"words": words, "minutes": max(1, math.ceil(words / WORDS_PER_MINUTE))}
