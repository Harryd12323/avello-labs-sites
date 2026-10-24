# Avello Labs website (avellolabs.com)

## What it is
- The official site for Avello Labs, Harris's own business: SEO, AEO, monthly website care, fast websites and custom web apps for local businesses. So the client is Avello Labs itself.
- Plain static HTML, CSS and a little JavaScript, served by GitHub Pages (`CNAME`, `_config.yml`). No build step.
- Pages: home, /seo/, /aeo/, /website-care/, /web-apps/, /check/, /tools/ (3 free tools), /blog/ (3 posts, all published), /privacy/, /terms/, /demo/.
- /demo/ is a noindex "Tech Log Tool" page (Verizon Reveal GPS exports into a weekly tech log workbook). CHECK: who it is for.
- Contact form posts to Web3Forms and reaches harris@avellolabs.com. Its key is public by design.

## Tech
- `scripts/site.py` (Python stdlib): keeps the shared head/header/footer in sync, builds sitemap, blog list, `blog/feed.xml`, `worker/knowledge.txt`. `scripts/blogpost.py`: blog text format and post rules.
- Three Cloudflare Workers (TypeScript, wrangler, Durable Objects for rate limits):
  - `worker/` avello-chat: chat assistant on the Anthropic API (model `claude-haiku-5-5`), answers from `KNOWLEDGE_PAGES`.
  - `check-worker/` avello-check: free website check, search preview, AI crawler check, newsletter tickets. No AI, no secrets.
  - `alerts-worker/` avello-alerts: sends leads to Harris on Telegram. `workers-shared/` holds the signed lead ticket code.
- Secrets are set with `npx wrangler secret put`, never in files. `brand/build.py` builds the logo SVGs (needs fonttools, uharfbuzz, Pillow).

## Run and test
- Preview: `python3 -m http.server 8000`, open http://localhost:8000 (root paths, so files won't work opened directly).
- After any change to shared parts: `python3 scripts/site.py sync`. New page: `site.py new`; blog: `post`, `publish`, `check-post`, `import-post`, `keywords`, `check-keyword` (see README).
- Blog build tests: `python3 scripts/test_site.py`. Worker tests: `npm test` in check-worker and alerts-worker; `npm run typecheck` in all three.
- Chat worker locally without the API: `npm run dev` (MOCK mode). End-to-end lead test: header of `alerts-worker/test/integration.ts`.
- `site.py` uses backslashes inside f-strings, so it needs Python 3.12 or newer. This Mac has Python 3.9.6 and no `node`, so on 2026-10-24 the blog tests failed with a SyntaxError and the worker tests could not run.

## Status (2026-10-24)
- Live: `NOINDEX = False` in `scripts/site.py`. All three blog posts published. `PRICE_FROM` is empty, so prices stay hidden.
- Latest work (Oct 21) was the /demo/ page. CHECK: whether the Workers are deployed with the current code.
- `concepts/` stays local only and is never committed or pushed (`.gitignore`).

## Rules
- Edit shared parts in the templates in `scripts/site.py`, never between the `<!-- shared:... -->` markers in pages. Content outside the markers is hand-written and `sync` never touches it.
- Keep the source out of the public site: README, BLOG-NOTES, scripts and worker folders are listed in `_config.yml` `exclude`. Add new non-site files there.
- Name: "Avello Labs" (blog author/publisher). "Avello Labs LLC" only for the company in the home page schema. Email: harris@avellolabs.com.
- Brand colours: blue to cyan only, never purple or indigo. #4D74F2 brand blue, #62AFF9 light blue, #22D3EE cyan, #0A1022 navy wordmark, #070A19 site background. Buttons use dark text #061325, not white (contrast).
- Font: Montserrat. Wordmark "Avello" SemiBold 600 with a Λ for the A, "Labs" Light 300. `logo-ring.svg` is for dark backgrounds only. Change logo colours in `brand/build.py`, not the SVGs.
- Copy: no em or en dashes or spaced hyphens; "we" and "us", never "our team"/"the team"; straight apostrophes and curly double quotes; no statistics or invented numbers; no promises (guarantees, "first page on Google", "overnight").
- Banned words list: `BANNED` in `scripts/blogpost.py` (seamless, elevate, leverage, unlock, robust, delve, tailored, journey, and more).
- Never name the owner's nearby towns in posts: Haddon Township, Collingswood, Haddonfield. Collingswood now appears only in the business mailing address (PO Box 141, Collingswood, NJ) in the footers, Privacy, Terms and the homepage's structured data, kept on purpose; examples use Cherry Hill.
- Factual claims name their source ("Google says..."). Page titles Title Case, under 62 characters with " | Avello Labs"; headings sentence case; meta descriptions 120 to 160 characters.
- Drafts must stay noindex and out of the sitemap and feed; live pages never link to drafts.
- Main nav is full (about 1050px). Blog link lives in the footer only.
