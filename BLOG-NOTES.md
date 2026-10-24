# Blog build: overnight notes

Built on the night of October 19, 2026. Nothing has been committed, pushed or deployed. This file is listed in
`_config.yml` so GitHub Pages won't publish it.

## Morning summary

**What's ready to review** (open http://localhost:8000/blog/ while the local server is running, or start it with
`python3 -m http.server 8000` from the repo root):

- `/blog/`: the index page, listing the three drafts.
- Three draft posts, each with a "Draft" label and a note at the top:
  1. `/blog/what-is-aeo-and-why-ai-answers-matter/` (881 words, 4 min read)
  2. `/blog/check-if-your-site-blocks-ai-crawlers/` (971 words, 5 min read)
  3. `/blog/google-business-profile-matters/` (936 words, 5 min read)
- `blog/feed.xml`: the RSS feed. It's empty until a post is published.
- `python3 scripts/site.py post ...` and `publish ...`: new commands to start and publish posts.
- `scripts/test_site.py`: 5 tests for the blog build.

**Tests:** all pass. That's the 5 new blog build tests, the 81 check-worker tests and the 6 alerts-worker tests, and all
three Workers type-check. I also checked the Article schema against the schema.org vocabulary on a copy with every post
published (0 errors), parsed the feed and sitemap as XML, and confirmed that running `sync` twice in a row changes nothing.

**Screenshots** at desktop (1366px) and phone (390px) width for every blog page:
`\\wsl.localhost\Ubuntu-24.04\tmp\claude-1000\-home-terryj-avello-labs-sites\ce75b73b-c6b0-478a-a61e-6dc754d37147\scratchpad\shots\blog`
No blog page is wider than the screen on a phone.

**One change outside the blog**, flagged so you can decide: `assets/site.css` gets a 3-line fix (decision 12 below).
It changes how the call-to-action buttons look on the live AEO, SEO, Website care and Web apps pages.

**Files changed:** `scripts/site.py`, `assets/site.css`, `README.md`, `_config.yml`.
**New:** `blog/` (index, 3 posts, feed.xml), `assets/blog.css`, `scripts/test_site.py`, this file.
`sitemap.xml`, `worker/knowledge.txt` and every existing page are unchanged, because nothing is published yet.

**To publish after you've reviewed the posts:**

```sh
python3 scripts/site.py publish /blog/what-is-aeo-and-why-ai-answers-matter/
python3 scripts/site.py publish /blog/check-if-your-site-blocks-ai-crawlers/
python3 scripts/site.py publish /blog/google-business-profile-matters/
```

Publish all three together, or edit the links first. Posts 1 and 3 link to each other in their text, and post 1 also
links to post 2. If you publish one on its own, `sync` will warn you that it links to a draft.

## Decisions, with reasoning

1. **The blog is built into `scripts/site.py`, not a separate generator.** Every page on the site is hand-written HTML
   with shared blocks filled in by `sync`, so posts work the same way. There's nothing new to learn or install, and the
   header, footer, security policy and newsletter stay in sync automatically.

2. **Post details live in the post's own `<head>`.** `<meta name="blog:status">` (draft or published),
   `article:published_time` and `article:modified_time`. The `article:` tags are standard Open Graph tags that social
   sites already read, so they do double duty. The headline comes from the `<h1>` and the summary from the meta
   description, so nothing is typed twice.

3. **`sync` generates the parts that would drift if they were hand-edited:** the byline, the reading time, the Article
   schema, the related links beside each post, the list on `/blog/`, the feed and the sitemap entries. Everything a
   person writes (headline, intro, body, the call to action at the end) stays hand-edited.

4. **Drafts are hidden in every way that counts.** They carry `noindex, nofollow`, they're left out of the sitemap and the
   feed, and they show a visible "Draft, not published" note. That way, even if they got pushed by accident, search
   engines and feed readers would skip them.

5. **The `/blog/` page lists drafts only while nothing is published.** You need to see the list to review it, so for now it
   shows all three drafts, and the page itself carries `noindex` and stays out of the sitemap. Once any post is
   published, the list shows published posts only, so a live page never links to a draft. The related links beside a
   published post follow the same rule.

6. **The footer gets a "Blog" link (under Company) only once a post is published.** I didn't add Blog to the main nav.
   The nav already needs about 1050px to fit on one line, and another item would push it to the phone-style menu on
   more laptops. Easy to add later if you want it there: it's the `NAV` list in `scripts/site.py`.

7. **The schema type is `Article`,** as you asked. Author and publisher are both the organization "Avello Labs" (not
   "Avello Labs LLC", which the home page schema uses for the company itself). It also has `wordCount`, `timeRequired`
   (the reading time) and `isPartOf` the blog. There's no `image` yet because the posts have no images. Google
   recommends one for Article results, so if you add a cover image later, put it in the schema too (one line in
   `blog_head`).

8. **Reading time is 230 words a minute, rounded up,** counting only the article text (not the sidebar or byline).
   230 sits in the middle of the commonly used 200 to 250 range.

9. **The feed is RSS 2.0 at `/blog/feed.xml`,** linked from the head of every blog page so feed readers can find it.
   Dates are set to noon UTC, so each post shows on the right day anywhere in the US. `lastBuildDate` is the newest
   post's date, not the time `sync` last ran, so the file only changes when a post does and doesn't show up in every diff.

10. **`publish` sets both dates to today.** The drafts carry October 19 as a placeholder. To show an update on a
    published post later, change `article:modified_time` and run `sync`. An "Updated" line then appears under the byline,
    and `dateModified` in the schema and the sitemap's `lastmod` follow it.

11. **Page titles are Title Case and 54 to 61 characters,** matching the rest of the site and short enough that Google
    shouldn't cut them off. The headings on the page are sentence case. The meta descriptions are 139 to 149 characters.

12. **Fixed a button bug that also affects live pages.** The article link style (light text, cyan underline) was beating
    the button style, so buttons inside an article showed light, underlined text on the blue gradient instead of the
    dark text every other button uses. That's already the case on the live AEO, SEO, Website care and Web apps pages,
    at the bottom of each one. The fix is a 3-line rule in `assets/site.css` (`.prose a.btn`). If you'd rather keep that
    file untouched, the same rule could go in `assets/blog.css`, but then the live pages keep the bug.

13. **Blog posts aren't added to the chat assistant's knowledge yet.** The assistant answers from a fixed list of pages
    (`KNOWLEDGE_PAGES`), and adding drafts would let it quote unpublished text. After publishing, you can add the post
    URLs to that list, run `sync` and redeploy the chat Worker.

14. **Each post links to the free tool that fits it best,** in the text and in the call to action at the end: the site
    check (post 1), the AI crawler check (post 2) and the schema generator (post 3). Every post also has the same sidebar,
    with the site check, the four free tools, `/tools/` and the other posts.

15. **No blog agent,** as you asked. Nothing in this build calls an AI model.

## Writing choices

- **No statistics anywhere.** Where a post makes a factual claim, it's something the company in question says publicly in
  its own documentation, and the post names who said it ("Google says...", "OpenAI documents...").
- **Copy rules:** no em or en dashes, none of the flagged words, "we" and "us" rather than "our team", straight
  apostrophes and curly double quotes, matching the existing pages. The only matches from my word search were
  "whether your" and "your team" (meaning the reader's team).
- **The AEO post** builds on the existing `/aeo/` page instead of repeating it: more on why it matters now, and a
  step-by-step "what to do". Its example searches use Cherry Hill (Collingswood was changed to Cherry Hill, October 2026:
  it's one of the towns posts never name).
- **The crawler post** uses the same bot names and descriptions as the AI crawler check (`check-worker/src/bots.ts`,
  reviewed October 2026), so the post and the tool agree.

### Claims worth a second look before publishing

Each of these comes from the company's own documentation as of my knowledge. They change, so they're worth a quick
check against the current docs:

- Google: no extra technical requirements to appear in AI Overviews or AI Mode beyond being indexed and eligible for a
  snippet; `nosnippet` keeps a page's text out of its AI features; robots.txt is generally refreshed within 24 hours;
  Google-Extended covers Gemini training and grounding but doesn't affect Search.
- OpenAI: GPTBot and OAI-SearchBot are separate, so blocking training doesn't block ChatGPT search.
- Google Business Profile: local results are based mainly on relevance, distance and prominence; review count and
  rating play a part; incentivized reviews and keywords added to the business name break the guidelines; verification
  methods vary (phone or text, email, video, postcard).
- The GBP post's AI answers paragraph was checked on October 20 against Google's "Optimizing your website for generative
  AI features on Google Search" guide (last updated 2026-07-10). That guide says AI responses "can include ... information
  about local businesses" and that Business Profiles can help businesses be visible in AI responses. It doesn't mention
  Maps listings or ratings, so the post now says only what the guide says.

## Not done

- Nothing committed, pushed or deployed.
- `brand/gbp/` is still untracked and untouched.
