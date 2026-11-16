// The 5 tip emails for quiz signups who ticked the box and then confirmed: their text, when each one is due,
// the signed links in them, and the check on Resend's webhook. Pure functions so all of it can be unit tested;
// tipslist.ts stores the list and sends on schedule, tipsroutes.ts handles the links and the webhook.
// The copy matches docs/quiz-followup-emails.md (Harris approved it on Nov 15, 2026); change both together.

import { greeting } from "./message.ts";

export { greeting };
import { emailButton, GUIDES, type Guide } from "./quiz.ts";

const FONT = "Arial,Helvetica,sans-serif";
export const ADDRESS = "Avello Labs, PO Box 141, Collingswood, NJ";

// ---------- Copy ----------
// Body format: paragraphs separated by blank lines, "- " bullets, **bold**, bare https:// links. {cta} is a
// button (HTML) or "label: link" line (text).

type Tip = { subject: string; preview: string; body: string; cta?: { label: string; path: string } };

export const TIPS: Tip[] = [
  {
    subject: "One quick fix: can people call you in one tap?",
    preview: "Try this on your own phone. It takes a minute.",
    body: `Thanks again for taking the quiz. Over the next few weeks I'll send you a few short tips, one at a time. Here's the first.

Pick up your phone, open your website, and try to call yourself. Then ask:

- Is your phone number near the top of the page, without scrolling?
- Does tapping it start a call, or do you have to copy it?
- Is it the same number that's on your Google listing?

If any answer is no, that's worth fixing first. Someone looking for help on their phone usually wants to call now, and every extra step is a chance for them to go back and pick someone else.

If your site is built on a common platform, making the number tappable is usually a small setting or one line of code. If you're not sure how, reply to this email and I'll tell you where to look.`,
  },
  {
    subject: "The free Google listing most businesses leave half done",
    preview: "Google says complete, accurate info helps.",
    body: `When someone searches for a business like yours nearby, the box with the map, hours, photos and reviews usually comes from your Google Business Profile. It's free, and it's often the first thing people see, before your website.

Google says complete and accurate information helps your business show up in local results. So log in at business.google.com and check:

- Your hours, including holiday hours
- Your phone number and website address
- Your services and the areas you serve
- A few recent photos of your work, your team or your place
- Replies to your reviews, good and bad. Google says responding shows you value your customers.

Set a reminder to look at it once a month. Ten minutes is usually enough.

If you want a quick look at how your website appears in search, our free site check does that: https://avellolabs.com/check/`,
  },
  {
    subject: "Can ChatGPT read your website?",
    preview: "A setting you've never seen might be blocking it.",
    body: `More people now ask tools like ChatGPT and Perplexity for recommendations. Those tools can only suggest your business if they can read your website.

Every site has a small file called robots.txt that tells bots where they can go. Sometimes it, or a security setting at your web host, blocks AI search bots without anyone meaning to.

You can check in under a minute with our free tool: https://avellolabs.com/tools/ai-crawler-check/

What the results mean:

- **AI search bots blocked:** worth fixing if you want to show up in AI answers.
- **AI training bots blocked:** that's a fair choice, and it doesn't keep you out of AI search.

If something looks off and you're not sure what to change, reply and tell me what it says.`,
  },
  {
    subject: "Write down the questions customers ask you",
    preview: "They make the best website content.",
    body: `Here's a tip that costs nothing but a little time.

Think about the questions customers ask you on the phone, by email or in person. Things like “Do you work in my town?”, “How long does it take?” or “What happens on the first visit?” Write down five of them.

Then answer each one on your website, in plain words, the way you'd answer out loud. A short questions section on your main service page works well.

Why it helps:

- The person reading gets their answer without having to call and ask, which builds trust.
- Google and AI tools look for clear answers to real questions, so plain question and answer content gives them something useful to show.

Keep the answers short and honest. If the true answer is “it depends”, say what it depends on.`,
  },
  {
    subject: "Want me to look at your site with you?",
    preview: "Free, 20 minutes, no obligation.",
    body: `This is the last tip email. I hope a few of them were useful.

If you'd like a second pair of eyes, I offer a free 20-minute review. I look at your website and your Google listing before we talk, and on the call I walk you through the 3 fixes I'd tackle first. You can make them yourself or with whoever looks after your site. No obligation, and no pressure to hire us.

{cta}

Or just reply to this email. We'll get back to you within 1 business day to pick a time.`,
    cta: { label: "Book your free review", path: "/#contact" },
  },
];

// Email 5 for people who got the "Stop doing it by hand" guide.
export const TIP5_TOOL: Tip = {
  subject: "Want to talk through the work you do by hand?",
  preview: "Free, 20 minutes, no obligation.",
  body: `This is the last tip email. I hope a few of them were useful.

You told us your business spends too much time on admin by hand. If you'd like to talk it through, I offer a free 20-minute call. Tell me about the task, and I'll tell you honestly whether a custom tool is worth it, or whether something you already pay for could do the job. No obligation.

{cta}

Or just reply to this email. We'll get back to you within 1 business day to pick a time.`,
  cta: { label: "Book your free call", path: "/?offer=tool#contact" },
};

export const TIP_COUNT = TIPS.length;


const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/https:\/\/[^\s<]+[^\s<.,:;)]/g, (u) => `<a href="${u}" style="color:#4D74F2">${u}</a>`);
}

function bodyHtml(body: string, cta?: { label: string; href: string }): string {
  const p = `margin:0 0 16px;font:16px/1.6 ${FONT};color:#1b2236`;
  return body.split("\n\n").map((block) => {
    if (block === "{cta}") return cta ? `${emailButton(cta.href, cta.label, true)}<div style="height:16px"></div>` : "";
    const lines = block.split("\n");
    if (lines.every((l) => l.startsWith("- "))) {
      return `<ul style="margin:0 0 16px;padding-left:22px">${lines.map((l) => `<li style="margin:0 0 6px;font:16px/1.6 ${FONT};color:#1b2236">${inline(l.slice(2))}</li>`).join("")}</ul>`;
    }
    return `<p style="${p}">${inline(block)}</p>`;
  }).join("\n");
}

function bodyText(body: string, cta?: { label: string; href: string }): string {
  return body.replace("{cta}", cta ? `${cta.label}: ${cta.href}` : "").replace(/\*\*(.+?)\*\*/g, "$1");
}

function shell(preview: string, inner: string): string {
  // The hidden preview text is what inboxes show next to the subject.
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:24px 16px;background:#ffffff">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preview)}</div>
<div style="max-width:560px;margin:0 auto">
${inner}
</div></body></html>`;
}

export type Rendered = { subject: string; text: string; html: string };

/** Tip email number step (0 to 4). */
export function renderTip(step: number, a: { site: string; name: string; guide: Guide; unsubscribeUrl: string }): Rendered {
  const tip = step === 4 && a.guide === "custom-tools" ? TIP5_TOOL : TIPS[step];
  const cta = tip.cta && { label: tip.cta.label, href: a.site + tip.cta.path };
  const hi = greeting(a.name);
  const footerText = "You're getting this because you took the website quiz at avellolabs.com and asked for 5 short tips. " +
    `Unsubscribe: ${a.unsubscribeUrl}\nOr reply “unsubscribe”.\n${ADDRESS}`;
  const text = [hi, "", bodyText(tip.body, cta), "", step === 4 ? "Thanks for reading,\nHarris\nAvello Labs" : "Harris\nAvello Labs", "", footerText].join("\n");
  const html = shell(tip.preview, `<p style="margin:0 0 16px;font:16px/1.6 ${FONT};color:#1b2236">${esc(hi)}</p>
${bodyHtml(tip.body, cta)}
<p style="margin:16px 0 0;font:16px/1.6 ${FONT};color:#1b2236">${step === 4 ? "Thanks for reading,<br>" : ""}Harris<br>Avello Labs</p>
<p style="margin:32px 0 0;font:13px/1.5 ${FONT};color:#55607a">You're getting this because you took the website quiz at avellolabs.com and asked for 5 short tips. <a href="${esc(a.unsubscribeUrl)}" style="color:#4D74F2">Unsubscribe</a> anytime, or reply “unsubscribe”.<br>${ADDRESS}</p>`);
  return { subject: tip.subject, text, html };
}

/** The one-off email for people who ticked the box before confirming existed. */
export function renderConfirm(a: { name: string; confirmUrl: string }): Rendered {
  const hi = greeting(a.name);
  const lines = [
    "When you took the website quiz at avellolabs.com, you ticked the box for 5 short website tips. Before we send any, please confirm you still want them.",
    "If you'd rather not, ignore this email and we won't send anything else.",
  ];
  const text = [hi, "", lines[0], "", `Yes, send me the tips: ${a.confirmUrl}`, "", lines[1], "", "Harris\nAvello Labs", "", ADDRESS].join("\n");
  const p = `margin:0 0 16px;font:16px/1.6 ${FONT};color:#1b2236`;
  const html = shell("One tap to confirm, or ignore this and we won't email again.", `<p style="${p}">${esc(hi)}</p>
<p style="${p}">${esc(lines[0])}</p>
${emailButton(a.confirmUrl, "Yes, send me the tips", true)}
<p style="margin:24px 0 16px;font:16px/1.6 ${FONT};color:#1b2236">${esc(lines[1])}</p>
<p style="${p}">Harris<br>Avello Labs</p>
<p style="margin:24px 0 0;font:13px/1.5 ${FONT};color:#55607a">${ADDRESS}</p>`);
  return { subject: "Do you still want the 5 website tips?", text, html };
}

// ---------- Schedule ----------

// Days after the guide email that each tip is due, and the least time between two tips.
export const OFFSET_DAYS = [2, 5, 9, 14, 21];
const MIN_GAP_DAYS = 2;
const TZ = "America/New_York";

/** The first moment at or after t when the clock in New York shows hour:00. */
export function atLocalHour(t: number, hour: number, tz = TZ): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(t / 1000) * 1000;
  let at = Date.UTC(parts.year, parts.month - 1, parts.day, hour) - offset;
  if (at < t) at += 24 * 3600_000;
  return at;
}

/** When tip number step is due. guideAt: when the guide email went out; after: the earliest allowed moment
 *  (confirmation time for the first tip, the previous send for the rest). */
export function dueAt(step: number, guideAt: number, after: number, previousSent: number | null, cfg: { dayMs: number; sendHour: number | null }): number {
  let t = Math.max(guideAt + OFFSET_DAYS[step] * cfg.dayMs, after);
  if (previousSent !== null) t = Math.max(t, previousSent + MIN_GAP_DAYS * cfg.dayMs);
  return cfg.sendHour === null ? t : atLocalHour(t, cfg.sendHour);
}

export function scheduleConfig(env: { TIPS_DAY_SECONDS: string; TIPS_SEND_HOUR: string }): { dayMs: number; sendHour: number | null } {
  const hour = env.TIPS_SEND_HOUR.trim();
  return { dayMs: Number(env.TIPS_DAY_SECONDS) * 1000, sendHour: hour === "" ? null : Number(hour) };
}

// ---------- Signed links ----------
// base64url(JSON) + "." + base64url(HMAC-SHA256). k: "c" confirm, "u" unsubscribe, "s" Harris's stop link.

export type LinkKind = "c" | "u" | "s";
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

const hmac = (key: Uint8Array | string) =>
  crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signLink(secret: string, kind: LinkKind, id: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ k: kind, id })));
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(secret), enc.encode(body))))}`;
}

/** The subscriber ID if the link is genuine and of the expected kind; otherwise null. */
export async function verifyLink(secret: string, kind: LinkKind, token: string | null): Promise<string | null> {
  if (!token || token.length > 300) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", await hmac(secret), unb64(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64(body)));
    return p?.k === kind && typeof p.id === "string" && /^[0-9a-f]{24}$/.test(p.id) ? p.id : null;
  } catch {
    return null;
  }
}

export function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Replies ----------

/** Resend signs webhooks the Svix way: HMAC-SHA256 of "id.timestamp.body" with the base64 key after "whsec_".
 *  Rejects anything older or newer than 5 minutes, so a captured request can't be replayed later. */
export async function verifyWebhook(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): Promise<boolean> {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  let key: Uint8Array;
  try {
    key = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(key), enc.encode(`${h.id}.${h.timestamp}.${body}`)));
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let given: Uint8Array;
    try {
      given = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    } catch {
      continue;
    }
    if (given.length === mac.length && given.every((b, i) => b === mac[i])) return true;
  }
  return false;
}

/** The subscriber ID in a reply address like replies+<id>@send.avellolabs.com, if the email went to one. */
export function replyId(addresses: unknown[], local: string, domain: string): string | null {
  const re = new RegExp(`^(?:.*<)?${local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\+([0-9a-f]{24})@${domain.replace(/\./g, "\\.")}>?$`, "i");
  for (const a of addresses) {
    const m = typeof a === "string" ? a.trim().match(re) : null;
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export function replyAddress(local: string, domain: string, id: string): string {
  return `${local}+${id}@${domain}`;
}

/** True for out-of-office notes, bounces and other automatic replies (the webhook gives only the sender and subject). */
export function isAutoReply(from: unknown, subject: unknown): boolean {
  const f = typeof from === "string" ? from.toLowerCase() : "";
  const s = typeof subject === "string" ? subject.toLowerCase() : "";
  if (/\b(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)[^@]*@/.test(f)) return true;
  return /\b(auto(matic)?[ -]?(reply|response|answer)|out of (the )?office|away from (the )?office|on (vacation|holiday|leave)|undeliverable|delivery (status notification|failure|has failed)|mail delivery failed|returned mail|abwesenheit|absence|réponse automatique)\b/.test(s);
}

// ---------- Backfill ----------

/** The key that unlocks the one-off backfill: the first 16 hex characters of the SHA-256 of the list (trimmed). */
export async function backfillKey(list: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(list.trim()));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Lines of "email | name | guide" (name and guide optional; guide as its key or title). Skips bad lines. */
export function parseBackfill(raw: string): Array<{ email: string; name: string; guide: Guide }> {
  const out: Array<{ email: string; name: string; guide: Guide }> = [];
  for (const line of raw.split("\n")) {
    const [email = "", name = "", g = ""] = line.split("|").map((s) => s.trim());
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) continue;
    const want = g.toLowerCase();
    const guide = (Object.keys(GUIDES) as Guide[]).find((k) => k === want || GUIDES[k].toLowerCase() === want) ?? "more-calls";
    out.push({ email, name, guide });
  }
  return out;
}

// ---------- Pages for the links ----------

export function page(title: string, message: string, form?: { action: string; label: string }): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | Avello Labs</title>
<style>body{margin:0;background:#070A19;color:#e8ecf7;font:17px/1.6 Montserrat,Arial,Helvetica,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px 16px;box-sizing:border-box}
main{max-width:480px;text-align:center}h1{font-size:1.6rem;line-height:1.25;margin:0 0 12px}p{margin:0 0 20px;color:#c9d1e6}
button{font:inherit;font-weight:700;color:#061325;background:linear-gradient(90deg,#4D74F2,#62AFF9,#22D3EE);border:0;border-radius:10px;padding:14px 28px;cursor:pointer}
a{color:#62AFF9}.brand{font-weight:600;letter-spacing:.02em;margin-bottom:28px;color:#fff}</style></head>
<body><main><p class="brand">Avello Labs</p><h1>${esc(title)}</h1><p>${esc(message)}</p>
${form ? `<form method="post" action="${esc(form.action)}"><button type="submit">${esc(form.label)}</button></form>` : `<p><a href="https://avellolabs.com/">Go to avellolabs.com</a></p>`}
</main></body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'", "X-Robots-Tag": "noindex" },
  });
}
