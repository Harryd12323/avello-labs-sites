# Humanizer rules

How Avello Labs copy should sound, on the site, in blog posts and in emails. Read this before writing anything a
customer will see. The checkers in `scripts/blogpost.py` (BANNED, DASHES, STATS, PROMISE, BLOCKED_PLACES) catch the
mechanical parts; the rest is on whoever writes.

## The voice

Write like Harris talking to a business owner across the counter. Someone from South Jersey who knows websites,
doesn't show off about it, and would rather tell you the truth than sell you something.

- **Short sentences.** Most under 20 words. One idea each. A long sentence now and then is fine.
- **Plain words.** "Use" not "utilize". "Help" not "empower". "Fix" not "optimize" when fix is what you mean.
- **Talk to one person.** "You" and "your business". Never "businesses like yours seeking to…".
- **"We" and "us"**, never "our team" or "the team". On /about/ and in emails, Harris can say "I".
- **Say the thing.** Lead with the answer or the benefit, then explain. Don't warm up.
- **Be specific.** "Your contact form stops sending" beats "technical issues may arise".
- **Local, but not a costume.** Mention South Jersey, Cherry Hill or Philly where it's true and useful. No "jawn",
  no "down the shore" jokes, no forced slang.

## AI tells to cut

- **Banned words:** the `BANNED` list in `scripts/blogpost.py` (unlock, elevate, seamless, leverage, robust, delve,
  journey, tailored, empower, in today's, digital landscape, game-changer, and more).
- **Lists of three everywhere.** "Fast, secure and reliable." One is fine. Three per paragraph reads like a robot.
  Use one or two things, or a real number of items.
- **Dashes.** No em dashes, no en dashes, no spaced hyphens. Use a period or a comma.
- **Colon reveals.** "Here's the thing: …", "The result? …". Just say it.
- **"Not X, but Y" / "It's not just X, it's Y".** Say what it is.
- **Empty openers and closers.** "In today's world", "When it comes to", "At the end of the day", "In conclusion",
  "Ready to take your business to the next level?".
- **Hedge stacks.** "It can potentially help to possibly improve". Pick one: "It can help".
- **Fake enthusiasm.** No exclamation marks in body copy. No "amazing", "incredible", "powerful".
- **Rhetorical question chains.** One question to open a section is plenty.
- **Same-length sentences in a row.** Vary them. Read it out loud. If you run out of breath, split it.

## Honesty rules (from CLAUDE.md, repeated because they matter most)

- No statistics or invented numbers. A factual claim names its source ("Google says…").
- No fake results, reviews, testimonials or client logos. Real ones only, with the client's OK.
- No promises about outcomes: no guarantees of rankings, "first page", "overnight", "more calls guaranteed".
  It's fine to promise what we control: replying within 1 business day, showing you changes before they go live.
- Speed: only "can be live in about a week once we have your content".
- Never put down agencies or competitors.
- Never name Haddon Township, Collingswood or Haddonfield (the mailing address in the footer is the exception).
- Straight apostrophes ('), curly double quotes (“ ”).

## Before and after

- Before: "We leverage cutting-edge technology to deliver seamless, robust websites tailored to your needs."
  After: "We build fast websites that make it easy for people to call you."
- Before: "Ongoing website care."
  After: "We keep your site running, so you're not the one worrying about it breaking or going out of date."
- Before: "In today's digital landscape, SEO is more important than ever."
  After: "When someone nearby searches for what you do, you want to be one of the names they see."
- Before: "Fast, secure, and reliable hosting for peace of mind, better rankings, and happier customers."
  After: "Your site loads fast on secure hosting, so visitors don't give up before they call."

## Quick self-check

1. Would Harris say this sentence out loud to a customer? If not, rewrite it.
2. Is there a number in it? Where did it come from?
3. Does it promise something we don't control?
4. Count the lists of three. Keep at most one per section.
5. Run the page through the checker (`site.py questions`, `industries`, `check-post`) before calling it done.
