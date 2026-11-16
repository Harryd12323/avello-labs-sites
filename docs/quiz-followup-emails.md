# Quiz follow-up emails (draft for review)

Five short emails for people who took the quiz on /tools/. One tip each, plain language, signed by Harris. The last one invites a free 20-minute call. Nothing is wired up: no sending code, no schedule, no changes to the quiz or the worker.

## Who gets these

Only people who tick this box on the quiz's last screen (separate from the newsletter box, unticked by default):

> Also send me 5 short website tips over the next few weeks. Unsubscribe anytime.

The guide email footer and the privacy policy say the same thing. The quiz worker passes the choice on as `tips` (it shows in Harris's copy of the answers and the Telegram alert). Sending isn't built yet.

Every email needs (US CAN-SPAM rules, and simple courtesy):

- A real one-click unsubscribe link in the footer (see below), plus the matching `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers so Gmail and Apple Mail show their own unsubscribe button. Replying “unsubscribe” should work too.
- The business mailing address: Avello Labs, PO Box 141, Collingswood, NJ.
- An honest subject line and the real sender (Harris at Avello Labs).

## Greeting

Every email opens with “Hi {first name},”: the first word of the name they typed in the quiz, with a capital first letter. If they left the name blank, or it doesn't look like a name (numbers, symbols, a web address, too long), use “Hi there,” instead.

## Unsubscribe link (plan, not built)

- Each email gets its own link, like `https://avello-alerts.avellolabs.workers.dev/unsubscribe?t={token}`, where the token is signed by the worker (same idea as the signed lead tickets in `workers-shared/`) so nobody can unsubscribe someone else by guessing.
- Opening the link shows a short page: “You're unsubscribed. We won't send you any more tips.” One click is enough: no login, no “are you sure”, no form.
- The same address handles the one-click `POST` that mail apps send from their own unsubscribe button.
- Unsubscribing stops the rest of the sequence right away and is remembered, so a later quiz signup doesn't restart it without a new tick in the box.

## Timing and variants

| Email | When | Tip |
| --- | --- | --- |
| 1 | 2 days after the guide | Make it easy to call you from a phone |
| 2 | 5 days | Finish your Google Business Profile |
| 3 | 9 days | Check what AI tools can see |
| 4 | 14 days | Answer the questions people actually ask |
| 5 | 21 days | Invite to a free 20-minute review |

- People who got the “Stop doing it by hand” guide (custom-tools): emails 1 to 4 still work as general tips, but email 5 has a separate version below that offers the custom tool call instead.
- Stop the sequence as soon as someone books a call, replies, or unsubscribes.

Footer for every email:

> You're getting this because you took the website quiz at avellolabs.com and asked for 5 short tips. [Unsubscribe]({unsubscribe link}) with one click, or reply “unsubscribe”.
> Avello Labs, PO Box 141, Collingswood, NJ

---

## Email 1: Make it easy to call you

**Subject:** One quick fix: can people call you in one tap?
**Preview text:** Try this on your own phone. It takes a minute.

Hi {first name},

Thanks again for taking the quiz. Over the next few weeks I'll send you a few short tips, one at a time. Here's the first.

Pick up your phone, open your website, and try to call yourself. Then ask:

- Is your phone number near the top of the page, without scrolling?
- Does tapping it start a call, or do you have to copy it?
- Is it the same number that's on your Google listing?

If any answer is no, that's worth fixing first. Someone looking for help on their phone usually wants to call now, and every extra step is a chance for them to go back and pick someone else.

If your site is built on a common platform, making the number tappable is usually a small setting or one line of code. If you're not sure how, reply to this email and I'll tell you where to look.

Harris
Avello Labs

---

## Email 2: Finish your Google Business Profile

**Subject:** The free Google listing most businesses leave half done
**Preview text:** Google says complete, accurate info helps.

Hi {first name},

When someone searches for a business like yours nearby, the box with the map, hours, photos and reviews usually comes from your Google Business Profile. It's free, and it's often the first thing people see, before your website.

Google says complete and accurate information helps your business show up in local results. So log in at business.google.com and check:

- Your hours, including holiday hours
- Your phone number and website address
- Your services and the areas you serve
- A few recent photos of your work, your team or your place
- Replies to your reviews, good and bad. Google says responding shows you value your customers.

Set a reminder to look at it once a month. Ten minutes is usually enough.

If you want a quick look at how your website appears in search, our free site check does that: https://avellolabs.com/check/

Harris
Avello Labs

---

## Email 3: Check what AI tools can see

**Subject:** Can ChatGPT read your website?
**Preview text:** A setting you've never seen might be blocking it.

Hi {first name},

More people now ask tools like ChatGPT and Perplexity for recommendations. Those tools can only suggest your business if they can read your website.

Every site has a small file called robots.txt that tells bots where they can go. Sometimes it, or a security setting at your web host, blocks AI search bots without anyone meaning to.

You can check in under a minute with our free tool: https://avellolabs.com/tools/ai-crawler-check/

What the results mean:

- **AI search bots blocked:** worth fixing if you want to show up in AI answers.
- **AI training bots blocked:** that's a fair choice, and it doesn't keep you out of AI search.

If something looks off and you're not sure what to change, reply and tell me what it says.

Harris
Avello Labs

---

## Email 4: Answer the questions people actually ask

**Subject:** Write down the questions customers ask you
**Preview text:** They make the best website content.

Hi {first name},

Here's a tip that costs nothing but a little time.

Think about the questions customers ask you on the phone, by email or in person. Things like “Do you work in my town?”, “How long does it take?” or “What happens on the first visit?” Write down five of them.

Then answer each one on your website, in plain words, the way you'd answer out loud. A short questions section on your main service page works well.

Why it helps:

- The person reading gets their answer without having to call and ask, which builds trust.
- Google and AI tools look for clear answers to real questions, so plain question and answer content gives them something useful to show.

Keep the answers short and honest. If the true answer is “it depends”, say what it depends on.

Harris
Avello Labs

---

## Email 5: Free 20-minute review

**Subject:** Want me to look at your site with you?
**Preview text:** Free, 20 minutes, no obligation.

Hi {first name},

This is the last tip email. I hope a few of them were useful.

If you'd like a second pair of eyes, I offer a free 20-minute review. I look at your website and your Google listing before we talk, and on the call I walk you through the 3 fixes I'd tackle first. You can make them yourself or with whoever looks after your site. No obligation, and no pressure to hire us.

Book your free review: https://avellolabs.com/#contact

Or just reply to this email. We'll get back to you within 1 business day to pick a time.

Thanks for reading,
Harris
Avello Labs

### Email 5, custom-tools version

**Subject:** Want to talk through the work you do by hand?
**Preview text:** Free, 20 minutes, no obligation.

Hi {first name},

This is the last tip email. I hope a few of them were useful.

You told us your business spends too much time on admin by hand. If you'd like to talk it through, I offer a free 20-minute call. Tell me about the task, and I'll tell you honestly whether a custom tool is worth it, or whether something you already pay for could do the job. No obligation.

Book your free call: https://avellolabs.com/?offer=tool#contact

Or just reply to this email. We'll get back to you within 1 business day to pick a time.

Thanks for reading,
Harris
Avello Labs
