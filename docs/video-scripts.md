# Website videos: AI voiceover explainer scripts

Four short explainer videos for the site: the homepage welcome and one for each problem page. Animated, with an AI voiceover, in the same look as Vid's explainer reels. Nothing is rendered yet.

The homepage welcome video is done and live (YouTube ID ftNlVSYWDOI). The three problem page videos are still to make.

## Putting a video on the site

1. Upload to YouTube. Public or Unlisted both work; Public also helps people find you on YouTube.
2. Copy the video ID: the 11 characters after `watch?v=` in the address.
3. Make a 1280x720 JPG thumbnail (a clear frame from the video, plus a few words of text if it needs them) and save it as:
   - welcome video: `assets/videos/welcome.jpg`
   - problem pages: `assets/videos/cant-find-us.jpg`, `assets/videos/no-calls.jpg`, `assets/videos/too-much-admin.jpg`
4. Fill in the ID and the day it went up:
   - welcome video: `WELCOME_VIDEO` and `WELCOME_VIDEO_DATE` in `scripts/site.py`
   - problem pages: `Video:` and `Video-date:` in `scripts/problems/<page>.txt`, and paste the corrected captions under `## Video transcript` as plain paragraphs
5. Run `/opt/homebrew/bin/python3.12 scripts/site.py problems`, preview, then push. Or send me the ID and I'll do steps 3 to 5.

Until then, each page has a marked, hidden video spot. Add `?spots` to a page address in a preview (for example http://localhost:8001/no-calls/?spots) to see where the video goes.

## Ground rules for all four

- **Tone:** never put down agencies, other developers or competitors, not even by hint (“unlike other agencies…”). Earn trust by being useful: explain the problem, show what we do, give something free.
- **Copy rules, same as the site:** no promises (“first page”, “guaranteed”), no numbers we can't back up, no em dashes, and if a claim comes from Google, say so.
- **Voiceover:** about 150 words a minute. The voiceover lines below are written to be read word for word, because an AI voice needs exact text. Pauses are marked with “/”.
- **Voice:** one warm, calm, natural-sounding voice for all four (American English, mid pace). If it's a clone of a real person's voice, use only your own, or someone who has agreed in writing.
- **Captions:** burn the voiceover in as captions. Most people watch on mute.
- **Look** (match Vid's reels; adjust these defaults to them):
  - Navy background (#070A19), blue to cyan gradient accents (#4D74F2, #62AFF9, #22D3EE), white text. No purple.
  - Big kinetic words for key phrases, simple line icons, and simple phone and browser mock-ups.
  - Mock-ups use made-up businesses only. No real client sites, data or names, and no real competitor names or logos.
  - Light, upbeat music bed under the voice, with a soft whoosh or click on key words.
- **Format:** 16:9 for the site and YouTube. You can export a 9:16 cut for reels later from the same project, with text kept inside the centre.
- **End card (last 3 seconds):** the Avello Labs logo, the call to action, and avellolabs.com. That way it still makes sense on YouTube, away from the page.

---

## 1. Homepage welcome (about 45 seconds, about 100 words)

**Job:** the viewer recognizes their problem and taps one of the 3 buttons under the video.

| Time | Voiceover | On screen |
| --- | --- | --- |
| 0 to 4 s | “Your website should be bringing you calls. / Is it?” | A phone screen with a website. A call icon pulses, then goes quiet. Text: **Is it bringing you calls?** |
| 4 to 9 s | “If you run a business in South Jersey or Philly, / it usually comes down to one of three things.” | A simple map outline of South Jersey and Philly, then three empty cards slide in. |
| 9 to 14 s | “One: / customers can't find you on Google, / or in AI answers like ChatGPT.” | Card 1 fills: a search bar with a magnifying glass, results scrolling past without you. Text: **Can't find you** |
| 14 to 18 s | “Two: / they find your website, / but they don't call.” | Card 2: a visitor cursor on a site, then it leaves. Text: **Find you, don't call** |
| 18 to 23 s | “Three: / you're buried in admin / that eats your evenings.” | Card 3: a growing stack of spreadsheets and a clock ticking past 9pm. Text: **Buried in admin** |
| 23 to 32 s | “We fix the one that's holding you back, fast. / Then we keep your site healthy every month, / so it keeps working.” | One card lights up in the gradient, and a checkmark sweeps through it. Then a calendar with a small heartbeat line. Text: **Fix it. Keep it healthy.** |
| 32 to 45 s | “Which one sounds like you? / Pick it below, / and we'll show you why it happens and what to do next.” | The three cards line up and an arrow points down. End card: logo, **Pick yours below**, avellolabs.com |

---

## 2. “Customers can't find us on Google or in AI answers” (/cant-find-us/, about 60 seconds, about 150 words)

**Job:** they understand why it happens, see what we do, and get the free guide.

| Time | Voiceover | On screen |
| --- | --- | --- |
| 0 to 5 s | “You're good at what you do. / So why does someone else show up / when customers search?” | A phone search for “roof repair near me”. Results appear, none of them the viewer. Text: **Why not you?** |
| 5 to 17 s | “Google says it ranks local businesses mostly on three things: / how well you match the search, / how close you are, / and how well known you are.” | Three icons build one by one: a target (match), a map pin (distance), a star (well known). Small label: **Source: Google** |
| 17 to 30 s | “When one is missing, you slip down the list. / Often it's simple. / Your site doesn't say clearly what you do and where. / Your Google Business Profile is half finished. / Or a hidden setting stops AI tools like ChatGPT from reading your site at all.” | A list ticks down three causes, each with a quick visual: vague page text, a half-filled profile card, a robot icon stopped by a closed gate. |
| 30 to 48 s | “Here's what we do. / We check how you show up today. / We fix your site and your Google listing, / so they say exactly what you do and where, / and we make sure AI tools can read you. / Then we keep it up to date, every month.” | A checklist fills in with gradient checkmarks: **Check where you stand**, **Fix site and listing**, **Open the door to AI tools**, **Keep it current**. |
| 48 to 60 s | “Want to start on your own? / Get our free guide below: / Get found on Google and in AI answers.” | A guide cover with the title flips open, then an arrow points down. End card: logo, **Free guide below**, avellolabs.com |

---

## 3. “Our website doesn't bring in calls” (/no-calls/, about 60 seconds, about 150 words)

**Job:** they see where calls leak, see what we do, and get the free guide.

| Time | Voiceover | On screen |
| --- | --- | --- |
| 0 to 5 s | “People visit your website. / Then nothing. / No calls, / no messages.” | A visitor counter ticks up, while a phone icon stays silent. Text: **Visits. No calls.** |
| 5 to 13 s | “A visitor usually wants two answers, fast: / can you help, / and how do I reach you? / If that's hard to find, they go back and pick someone else.” | Two question bubbles pop up over a phone. A back arrow appears and the visitor leaves. |
| 13 to 28 s | “It's usually one of a few things. / The phone number is hard to find, / or you can't tap it. / The site loads slowly on phones. / It doesn't say clearly what you do. / Or the contact form stopped working, / and nobody noticed.” | Quick cuts, each with a short label: a tiny untappable number, a loading spinner, a vague headline, and a form whose message flies into a void. |
| 28 to 47 s | “Here's what we do. / We go through your site the way a customer would, on a phone. / We fix what's in the way, / or build a fast new site if that makes more sense. / Then we test your forms / and keep everything current, every month.” | A phone walkthrough: the number becomes a big tap-to-call button, the page snaps in quickly, and the headline turns clear. Then a calendar ticks with gradient checkmarks: **Fix or rebuild**, **Test the forms**, **Keep it current**. |
| 47 to 60 s | “Want to check your own site first? / Get our free guide below: / A website that turns visitors into calls.” | A guide cover with the title, then an arrow down. End card: logo, **Free guide below**, avellolabs.com |

---

## 4. “We spend too much time on admin by hand” (/too-much-admin/, about 60 seconds, about 145 words)

**Job:** they recognize the pattern, learn it might not need anything new, and get the free guide.

| Time | Voiceover | On screen |
| --- | --- | --- |
| 0 to 8 s | “Copying the same numbers between spreadsheets. / Typing a customer's details for the third time. / Building the same report every Friday.” | Three quick loops: cells copying across, the same name typed into three forms, a calendar that keeps landing on Friday. |
| 8 to 18 s | “It doesn't start as a problem. / Information ends up in too many places, / and the software you have almost fits, / so the gaps get filled by hand.” | App icons scattered and disconnected, with a person drawing lines between them by hand. Text: **Almost fits** |
| 18 to 30 s | “Here's what we do. / First, we look at what you already pay for. / Often a setting, / or a connection between two apps, / removes a whole step, / and you don't need anything new.” | The same icons, with one gradient line connecting two of them. A step disappears from a list. Text: **Use what you have** |
| 30 to 46 s | “When nothing off the shelf fits, / we build a simple tool around the way you already work. / One example: / a desktop app that turns a field sales team's GPS data into weekly logs, / a job that used to be done by hand every week.” | A generic desktop window: map pins flow in and a tidy weekly table builds itself. Made-up data only, no client name or logo. Text: **Built around your work** |
| 46 to 60 s | “Want to see which of your tasks are worth automating? / Get our free guide below: / Stop doing it by hand.” | A guide cover with the title, then an arrow down. End card: logo, **Free guide below**, avellolabs.com |

---

## Before rendering

- Read each voiceover aloud once with a timer. If it runs long, cut words rather than speeding up the voice.
- Check the mock-ups: no real client, no real competitor, no real personal data.
- Make sure the end card's guide title matches the page's guide box exactly.
- Once a video is on YouTube, paste its voiceover text under `## Video transcript` in the page's file in `scripts/problems/`, or into the welcome video notes. The voiceover above is the transcript.
