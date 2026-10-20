#!/usr/bin/env python3
"""Tests for scripts/site.py's blog build. Each test runs the script on a throwaway copy of the site, so the
real pages are never touched. From the repo root:

    python3 scripts/test_site.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS = ["/blog/what-is-aeo-and-why-ai-answers-matter/", "/blog/check-if-your-site-blocks-ai-crawlers/",
         "/blog/google-business-profile-matters/"]
NOINDEX = '<meta name="robots" content="noindex, nofollow">'
LEAVE_OUT = shutil.ignore_patterns(".git", "node_modules", ".wrangler", "concepts", "gbp", "work", "__pycache__")


class BlogBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        shutil.copytree(ROOT, self.site, ignore=LEAVE_OUT)
        # Every test starts from every post as a draft (these three and any published later), whatever state the
        # real copies are in.
        for f in (self.site / "blog").glob("*/index.html"):
            f.write_text(f.read_text().replace('<meta name="blog:status" content="published">',
                                               '<meta name="blog:status" content="draft">'))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def page(self, url):
        return self.site / url.strip("/") / "index.html"

    def run_site(self, *args, ok=True):
        r = subprocess.run([sys.executable, str(self.site / "scripts" / "site.py"), *args], capture_output=True, text=True)
        if ok:
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r

    def read(self, url):
        return self.page(url).read_text()

    def feed_items(self):
        channel = ET.parse(self.site / "blog" / "feed.xml").getroot().find("channel")
        return [(i.findtext("title"), i.findtext("link"), i.findtext("pubDate")) for i in channel.findall("item")]

    def sitemap(self):
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        return [u.findtext("s:loc", namespaces=ns) for u in ET.parse(self.site / "sitemap.xml").getroot()]

    def schema(self, url):
        block = re.search(r'<script type="application/ld\+json">\n(.*?)\n</script>', self.read(url), re.S)
        return json.loads(block.group(1))

    def test_drafts_stay_hidden(self):
        self.run_site("sync")
        self.assertEqual(self.feed_items(), [])
        self.assertFalse([u for u in self.sitemap() if "/blog/" in u])
        self.assertNotIn('href="/blog/"', self.read("/"), "no footer link while nothing is published")
        for url in POSTS + ["/blog/"]:
            self.assertTrue(NOINDEX in self.read(url), url)
        for url in POSTS:
            self.assertIn('class="draft-tag">Draft<', self.read(url))
            self.assertIn(f'href="{url}"', self.read("/blog/"), "drafts are listed on /blog/ for review")

    def test_publish_all(self):
        for url in POSTS:
            self.run_site("publish", url)
        today = date.today().isoformat()
        items = self.feed_items()
        self.assertEqual(sorted(i[1] for i in items), sorted("https://avellolabs.com" + u for u in POSTS))
        self.assertTrue(all(i[2] for i in items))
        self.assertEqual(len([u for u in self.sitemap() if "/blog/" in u]), 4)
        for url in ["/", "/seo/", "/tools/"]:
            self.assertIn('<li><a href="/blog/">Blog</a></li>', self.read(url))
        for url in POSTS + ["/blog/"]:
            self.assertFalse(NOINDEX in self.read(url), url)
        for url in POSTS:
            s = self.schema(url)
            self.assertEqual(s["@type"], "Article")
            self.assertEqual(s["author"], {"@type": "Organization", "name": "Avello Labs", "url": "https://avellolabs.com/"})
            self.assertEqual((s["datePublished"], s["dateModified"]), (today, today))
            self.assertEqual(s["url"], "https://avellolabs.com" + url)
            self.assertLessEqual(len(s["headline"]), 110, "Google truncates longer headlines")
            self.assertRegex(s["timeRequired"], r"^PT\d+M$")
            html = self.read(url)
            self.assertIn(f'<time datetime="{today}">', html)
            self.assertIn(f'min read', html)
            self.assertIn('href="/check/"', html)
            self.assertIn('href="/tools/"', html)
            self.assertFalse("draft-tag" in html or "draft-note" in html, url)

    def test_publish_one_never_links_to_drafts(self):
        first, *rest = POSTS
        out = self.run_site("publish", first).stdout
        self.assertEqual([i[1] for i in self.feed_items()], ["https://avellolabs.com" + first])
        for url in rest:
            aside = re.search(r"<!-- shared:post-aside -->.*?<!-- /shared:post-aside -->", self.read(first), re.S).group(0)
            self.assertFalse(f'href="{url}"' in aside, "the related links on a published post point to a draft")
            # The AEO post links to both other posts in its text, which sync can only warn about.
            self.assertIn(f"WARNING: {first} is published but links to the draft {url}", out)
            self.assertFalse(f'href="{url}"' in self.read("/blog/"), "/blog/ lists a draft once something is published")
            self.assertNotIn("https://avellolabs.com" + url, self.sitemap())
            self.assertTrue(NOINDEX in self.read(url), url)
        self.assertIn(f'href="{first}"', self.read(rest[0]), "drafts still link to everything, for review")

    def test_reading_time_counts_only_the_article(self):
        self.run_site("post", "/blog/test-post/", "Test post", "A test.")
        f = self.page("/blog/test-post/")
        words = " ".join(["word"] * 461)
        f.write_text(re.sub(r'(<article class="prose">).*?(</article>)', rf"\1<p>{words}</p>\2", f.read_text(), flags=re.S))
        self.run_site("sync")
        self.assertIn("3 min read", self.read("/blog/test-post/"))  # 461 words at 230 a minute, rounded up
        self.assertEqual(self.schema("/blog/test-post/")["wordCount"], 461)

    def test_bad_input_is_refused(self):
        self.assertNotEqual(self.run_site("post", "/blog/Bad Slug/", "x", "y", ok=False).returncode, 0)
        self.assertNotEqual(self.run_site("post", POSTS[0], "x", "y", ok=False).returncode, 0, "existing post")
        self.assertNotEqual(self.run_site("publish", "/blog/missing/", ok=False).returncode, 0)
        self.run_site("publish", POSTS[0])
        self.assertNotEqual(self.run_site("publish", POSTS[0], ok=False).returncode, 0, "already published")
        f = self.page(POSTS[1])
        f.write_text(f.read_text().replace('<meta name="blog:status" content="draft">', ""))
        r = self.run_site("sync", ok=False)
        self.assertIn("blog:status", r.stdout + r.stderr)


def sample_post(**changes):
    """A post in the blog text format that passes every rule; `changes` swaps whole header lines or adds text."""
    fields = {
        "Title": "How to Get Your Business Recommended by ChatGPT",
        "Headline": "How to get your business recommended by ChatGPT",
        "Description": "What ChatGPT looks at when it recommends a local business, and the fixes that make your "
                       "business easier for it to find and trust.",
        "Keyword": "how to get my business recommended by chatgpt",
        "Slug": "get-business-recommended-by-chatgpt",
        "Service page": "/aeo/",
        "Lede": "More customers ask ChatGPT who to call. Here is how to get your business recommended by ChatGPT "
                "when they do.",
    }
    fields.update({k: v for k, v in changes.items() if k in fields})
    filler = ("Write down what you do, where you work and how people can reach you, in the words your customers "
              "use. Keep those details the same on every page and listing, and check them every few months. ")
    sections = "\n\n".join(f"## Step {n}: keep your details clear\n{filler * 6}" for n in range(1, 5))
    text = "\n".join(f"{k}: {v}" for k, v in fields.items()) + f"""

In short:
- ChatGPT recommends businesses it can find and understand.
- Clear, consistent details on your site and listings help most.

## Why it matters
To get recommended by ChatGPT, your business details have to be easy to read. Our [AEO guide](/aeo/) explains the
basics, and the [free site check](/check/) shows what's missing on your own site.

{sections}

- Your services, in plain words
- The towns and counties you serve

{changes.get("extra", "")}

## Common questions
Q: Can I pay to be recommended by ChatGPT?
A: No. ChatGPT decides its own answers, so the best you can do is make your business easy to find and trust.
Q: How long does it take?
A: It depends on how often ChatGPT searches the web for your kind of question. Check again every month or two.
Q: Do I need special code?
A: Not special, but structured data helps search engines and AI tools read your business details.

Call to action: See what AI tools can read on your site | Run the free check to see what's missing. | Run a free site check | /check/
"""
    return text


class PostFormat(unittest.TestCase):
    """The blog text format (scripts/blogpost.py), check-post and import-post."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        shutil.copytree(ROOT, self.site, ignore=LEAVE_OUT)
        # Only the three starter posts: a post published later could own the sample's keyword or slug.
        for page in (self.site / "blog").glob("*/index.html"):
            if f"/blog/{page.parent.name}/" not in POSTS:
                shutil.rmtree(page.parent)
        self.draft = self.tmp / "post.txt"

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def run_site(self, *args):
        return subprocess.run([sys.executable, str(self.site / "scripts" / "site.py"), *args], capture_output=True, text=True)

    def problems(self, text):
        self.draft.write_text(text)
        r = self.run_site("check-post", str(self.draft))
        return json.loads(r.stdout)["problems"]

    def test_a_good_post_passes_and_imports_as_a_draft_with_faq_schema(self):
        self.assertEqual(self.problems(sample_post()), [])
        r = self.run_site("import-post", str(self.draft))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        page = (self.site / "blog" / "get-business-recommended-by-chatgpt" / "index.html").read_text()
        self.assertIn('<meta name="blog:status" content="draft">', page)
        self.assertIn('<meta name="blog:keyword" content="how to get my business recommended by chatgpt">', page)
        self.assertIn("<title>How to Get Your Business Recommended by ChatGPT | Avello Labs</title>", page)
        self.assertIn('<h2 id="faq">Common questions</h2>', page)
        self.assertIn('<a href="/check/">free site check</a>', page)
        self.assertIn('<a class="btn" href="/check/">Run a free site check', page)
        blocks = [json.loads(b) for b in re.findall(r'<script type="application/ld\+json">\n(.*?)\n</script>', page, re.S)]
        self.assertEqual([b["@type"] for b in blocks], ["Article", "FAQPage"])
        self.assertEqual(len(blocks[1]["mainEntity"]), 3)
        self.assertEqual(blocks[1]["mainEntity"][0]["name"], "Can I pay to be recommended by ChatGPT?")
        self.assertIn("ChatGPT decides its own answers", blocks[1]["mainEntity"][0]["acceptedAnswer"]["text"])
        self.assertIn(NOINDEX, page)

    def test_the_chat_call_to_action_opens_the_chat(self):
        text = sample_post().replace("| Run a free site check | /check/", "| Ask the chat | chat")
        self.assertEqual(self.problems(text), [])
        self.run_site("import-post", str(self.draft))
        page = (self.site / "blog" / "get-business-recommended-by-chatgpt" / "index.html").read_text()
        self.assertIn('href="#" data-open-chat>', page)
        self.assertIn('data-open-chat', (self.site / "assets" / "chat.js").read_text())

    def test_copy_rules(self):
        cases = {
            "em dash": ("It works \u2014 mostly.", "em dash"),
            "spaced hyphen": ("It works - mostly.", "spaced hyphen"),
            "banned word": ("A seamless experience.", '"seamless"'),
            "our team": ("Our team can help.", '"our team"'),
            "blocked town": ("Businesses in Haddonfield ask this too.", "Names Haddonfield"),
            "statistic": ("About 40% of people do this.", "statistic"),
            "studies": ("Studies show this works.", "statistic"),
            "price": ("A site costs $2,000.", "statistic or price"),
            "promise": ("We guarantee you'll rank.", "promise"),
            "outside link": ("See [this](https://example.com/).", "our own pages"),
            "missing page": ("See [this](/no-such-page/).", "no page at"),
            "missing section": ("See [this](/#nowhere).", "no /#nowhere section"),
        }
        for name, (extra, expected) in cases.items():
            with self.subTest(name):
                self.assertTrue(any(expected in p for p in self.problems(sample_post(extra=extra))),
                                self.problems(sample_post(extra=extra)))
        self.assertEqual(self.problems(sample_post(extra="No one can guarantee a mention. See [how it works](/#how).")), [])

    def test_structure_rules(self):
        self.assertTrue(any("competes with /blog/what-is-aeo" in p for p in
                            self.problems(sample_post(Keyword="why ai answers matter for local businesses"))))
        self.assertTrue(any("competes with /aeo/" in p for p in self.problems(sample_post(Keyword="what is aeo"))))
        self.assertTrue(any("isn't in the title" in p for p in self.problems(sample_post(Keyword="website backups"))))
        self.assertTrue(any("description is" in p for p in self.problems(sample_post(Description="Too short."))))
        self.assertTrue(any("characters with" in p for p in self.problems(sample_post(Title="X" * 60))))
        self.assertTrue(any("slug" in p for p in self.problems(sample_post(Slug="Bad Slug"))))
        no_check = sample_post().replace("[free site check](/check/)", "free site check")
        self.assertTrue(any("doesn't link to the free site check" in p for p in self.problems(no_check)))
        short = re.sub(r"## Step.*?(?=\n- Your services)", "", sample_post(), flags=re.S)
        self.assertTrue(any("words; it should be" in p for p in self.problems(short)))
        one_q = re.sub(r"Q: How long.*?(?=\nCall to action)", "", sample_post(), flags=re.S)
        self.assertTrue(any("FAQ has 1 questions" in p for p in self.problems(one_q)))
        no_cta = sample_post().split("Call to action:")[0]
        self.assertTrue(any("Missing the \"Call to action:\"" in p for p in self.problems(no_cta)))

    def test_import_refuses_a_post_that_fails_the_rules(self):
        self.draft.write_text(sample_post(extra="A seamless experience."))
        r = self.run_site("import-post", str(self.draft))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("seamless", r.stdout + r.stderr)
        self.assertFalse((self.site / "blog" / "get-business-recommended-by-chatgpt").exists())

    def test_keywords_lists_every_page_and_post(self):
        out = json.loads(self.run_site("keywords").stdout)
        urls = {o["url"]: o["keyword"] for o in out}
        self.assertEqual(urls["/aeo/"], "what is aeo")
        self.assertEqual(urls["/blog/google-business-profile-matters/"], "why your google business profile matters")

    def test_check_keyword_names_the_pages_it_would_compete_with(self):
        hits = json.loads(self.run_site("check-keyword", "what is aeo").stdout)
        self.assertEqual([h["url"] for h in hits], ["/aeo/"])
        self.assertEqual(json.loads(self.run_site("check-keyword", "how to show up on google maps").stdout), [])

    def test_sitemap_dates_come_from_git_in_a_clone(self):
        git = lambda *a, **env: subprocess.run(["git", "-C", str(self.site), *a], capture_output=True, text=True,
                                               env={**os.environ, **env}, check=True)
        git("init", "-q")
        git("add", "-A")
        git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "x",
            GIT_COMMITTER_DATE="2020-01-02T12:00:00", GIT_AUTHOR_DATE="2020-01-02T12:00:00")
        r = self.run_site("sync")
        self.assertEqual(r.returncode, 0, r.stderr)
        sitemap = (self.site / "sitemap.xml").read_text()
        self.assertIn("<loc>https://avellolabs.com/seo/</loc><lastmod>2020-01-02</lastmod>", sitemap)


class PriceLine(unittest.TestCase):
    PAGES = ["/", "/seo/", "/aeo/", "/website-care/", "/web-apps/"]

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.site = self.tmp / "site"
        shutil.copytree(ROOT, self.site, ignore=LEAVE_OUT)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def sync_with_price(self, price):
        script = self.site / "scripts" / "site.py"
        script.write_text(re.sub(r'^PRICE_FROM = ".*"$', f"PRICE_FROM = {price!r}", script.read_text(), count=1, flags=re.M))
        r = subprocess.run([sys.executable, str(script), "sync"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return {url: (self.site / url.strip("/") / "index.html").read_text() if url != "/" else (self.site / "index.html").read_text()
                for url in self.PAGES}

    def test_blank_price_hides_the_line_everywhere(self):
        for url, page in self.sync_with_price("").items():
            tags = re.findall(r"<\w+[^>]* data-price[^>]*>", page)
            self.assertTrue(tags, url)
            self.assertTrue(all(t.endswith(" hidden>") for t in tags), url)
            self.assertFalse("$___" in page, url)
        self.assertFalse("Packages starting at" in (self.site / "worker" / "knowledge.txt").read_text())

    def test_set_price_shows_it_everywhere(self):
        for url, page in self.sync_with_price("$1,500").items():
            self.assertFalse(re.search(r"data-price[^>]*hidden", page), url)
            self.assertTrue('<span class="price-amount">$1,500</span>' in page, url)
        self.assertTrue("Packages starting at $1,500" in (self.site / "worker" / "knowledge.txt").read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
