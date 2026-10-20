#!/usr/bin/env python3
"""Tests for scripts/site.py's blog build. Each test runs the script on a throwaway copy of the site, so the
real pages are never touched. From the repo root:

    python3 scripts/test_site.py
"""
import json
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
        # Every test starts from all three posts as drafts, whatever state the real copies are in.
        for url in POSTS:
            f = self.page(url)
            f.write_text(f.read_text().replace('content="published"', 'content="draft"'))

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
