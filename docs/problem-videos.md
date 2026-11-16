# Video script outlines

Four short videos: one welcome video for the top of the homepage, and one for each problem page. These are outlines, not word-for-word scripts. Say it the way you'd say it to a customer across a counter. Same rules as the site: no promises (“first page”, “guaranteed”), no numbers you can't back up, and if you mention what Google says, say that it's Google saying it.

## For every video

- **Length:** welcome 30 to 45 seconds; problem videos 60 to 90 seconds. Shorter is better.
- **Format:** horizontal (16:9), 1080p is plenty. Phone on a tripod at eye level, window light in front of you, quiet room. A cheap clip-on mic makes the biggest difference.
- **First line:** the problem in their words, in the first 5 seconds. No logo intro, no “Hi, I'm Harris from…” before the point.
- **Captions:** most people watch on mute. Upload the video, let YouTube make captions, then fix any mistakes in YouTube Studio.
- **End:** point to what's on the page (“the buttons below”, “the free guide below”). Don't say “link in the description”: on the site there is none.

## After filming, to put a video on the site

1. Upload to YouTube. Public or Unlisted both work; Public also helps people find you on YouTube.
2. Copy the video ID: the 11 characters after `watch?v=` in the address.
3. Make a 1280x720 JPG thumbnail (a clear still of you, plus a few words of text) and save it as:
   - welcome video: `assets/videos/welcome.jpg`
   - problem pages: `assets/videos/cant-find-us.jpg`, `assets/videos/no-calls.jpg`, `assets/videos/too-much-admin.jpg`
4. Fill in the ID and the day it went up:
   - welcome video: `WELCOME_VIDEO` and `WELCOME_VIDEO_DATE` in `scripts/site.py`
   - problem pages: `Video:` and `Video-date:` in `scripts/problems/<page>.txt`, and paste the corrected captions under `## Video transcript` as plain paragraphs
5. Run `/opt/homebrew/bin/python3.12 scripts/site.py problems`, preview, then push. Or send me the ID and I'll do steps 3 to 5.

Until then, each page has a marked, hidden video spot. Add `?spots` to a page address in a preview (for example http://localhost:8001/no-calls/?spots) to see where the video goes.

---

## 1. Welcome video (homepage, 30 to 45 seconds)

**Goal:** they recognize themselves in one of the 3 situations and tap a button.

| Beat | What to say (roughly) | On screen |
| --- | --- | --- |
| Hook (0 to 5 s) | “If you're here, you're probably dealing with one of three things.” | You, close up |
| The three (5 to 25 s) | “Customers can't find you on Google, or in AI tools like ChatGPT. Or people find your website, but they don't call. Or you're spending your evenings on admin that should take minutes.” | Optional text for each as you say it |
| Who you are (25 to 35 s) | “I'm Harris. I run Avello Labs, and I help local businesses in South Jersey and Philly fix exactly these.” | You |
| Close (35 to 45 s) | “Pick the one that sounds like you below. Each one explains why it happens and what to think about before you spend anything.” | Gesture down |

**Thumbnail text:** “Which one is you?”

---

## 2. “Customers can't find us on Google or in AI answers” (/cant-find-us/, 60 to 90 seconds)

**Goal:** they understand it's fixable, try one thing themselves, and get the guide.

| Beat | What to say (roughly) | On screen |
| --- | --- | --- |
| Hook | “You're good at what you do, but when someone nearby searches for it, a competitor shows up instead.” | You |
| Why it happens | “Google says it mostly looks at three things for local results: how well you match the search, how close you are, and how well known you are. Usually one of those is missing. Maybe your site never says what you do and where. Maybe your Google listing is half finished.” | Optional: your own Google listing on screen |
| The thing they haven't considered | “Here's what most people miss. Searching your own business name proves nothing. New customers search for what you do, like ‘emergency plumber near me’. And AI tools like ChatGPT can only recommend you if your site lets them in. A hidden setting can block them.” | Screen recording: a “near me” search; the AI crawler check |
| One thing to try | “Today, search for what you do on your phone, the way a new customer would, and see who comes up.” | You |
| Close | “There's a free guide below with the checks that matter most. Or book a free 20-minute review and I'll walk you through the 3 fixes I'd tackle first.” | Gesture down |

**Thumbnail text:** “Why can't customers find you?”

---

## 3. “Our website doesn't bring in calls” (/no-calls/, 60 to 90 seconds)

**Goal:** they test their own site and see where calls leak.

| Beat | What to say (roughly) | On screen |
| --- | --- | --- |
| Hook | “People visit your website, and then nothing. No calls, no messages.” | You |
| Why it happens | “Usually it's one of a few things. The phone number is hard to find, or you can't tap it. The site is slow on phones. It doesn't say clearly what you do and where. Or it looks out of date, so people wonder if you're still open.” | Optional: a phone showing a slow page |
| The thing they haven't considered | “Here's the surprise: forms can stop working without any error. Messages just never arrive. And more visitors won't fix a site that doesn't turn visitors into calls.” | You |
| One thing to try | “Right now, open your site on your phone. Tap the number. Send yourself a message through the form. Check your hours.” | Screen recording of doing it |
| Close | “There's a free guide below on turning visitors into calls, and a free site check that looks at the technical side. Or book a free 20-minute review.” | Gesture down |

**Thumbnail text:** “Visitors but no calls?”

---

## 4. “We spend too much time on admin by hand” (/too-much-admin/, 60 to 90 seconds)

**Goal:** they write down one task and see whether it's worth a tool, with an honest answer that it might not be.

| Beat | What to say (roughly) | On screen |
| --- | --- | --- |
| Hook | “If you're copying the same numbers between spreadsheets every week, this one's for you.” | You |
| Why it happens | “Nobody plans it. Information ends up in five places, the software you bought almost fits, and the gaps get filled by hand, one workaround at a time.” | Optional: a messy spreadsheet (nothing real or private) |
| The thing they haven't considered | “Honestly, you might not need custom software. The tools you already pay for often do more than you're using. And when nothing fits, a small custom tool can be simpler than you think. We built one that turns a sales team's GPS data into weekly logs, a job someone used to do by hand every week.” | You (never name or show the client) |
| One thing to try | “Write down the steps of your most annoying weekly task, in order. That list tells you where the time really goes.” | You writing a list |
| Close | “The free guide below shows which tasks are worth automating, from simplest to custom. Or book a free 20-minute call, and I'll tell you honestly whether a tool is worth it.” | Gesture down |

**Thumbnail text:** “Still doing it by hand?”
