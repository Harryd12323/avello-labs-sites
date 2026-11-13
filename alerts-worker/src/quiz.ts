// The website quiz on /tools/: which guide fits a visitor's answers, and the emails that go out. Pure
// functions so the choice and the email text can be unit tested. assets/quiz.js shows the same questions
// and makes the same choice for the instant download; change both together.
// Nothing the visitor types goes into their own email, so the form can't be used to send someone a message.

import { clean } from "./message.ts";

export const QUESTIONS = [
  { q: "Do you have a website now?", a: ["No", "Yes, but it's old or I don't like it", "Yes, and it works fine"] },
  { q: "What's the biggest problem?", a: ["People can't find us on Google or in AI answers", "People visit but don't call",
    "Nobody keeps the site updated", "We do too much admin by hand"] },
  { q: "What should your site mainly do?", a: ["Show off our work", "Get calls and bookings", "Sell products", "Help run the business"] },
  { q: "Who looks after your site today?", a: ["Nobody", "Me, when I have time", "A developer or agency", "Not sure"] },
  { q: "When do you want this sorted?", a: ["ASAP", "In the next month or two", "Just exploring"] },
] as const;

export const GUIDES = {
  "get-found": "Get found on Google and in AI answers",
  "more-calls": "A website that turns visitors into calls",
  "site-health": "Keep your website healthy",
  "custom-tools": "Stop doing it by hand",
} as const;
export type Guide = keyof typeof GUIDES;

/** Answer indexes, one per question, or null if any is missing or out of range. */
export function parseAnswers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== QUESTIONS.length) return null;
  return value.every((v, i) => Number.isInteger(v) && v >= 0 && v < QUESTIONS[i].a.length) ? (value as number[]) : null;
}

/** No website yet means starting with the site itself; otherwise the biggest problem decides. */
export function pickGuide(answers: number[]): Guide {
  if (answers[0] === 0) return "more-calls";
  return (["get-found", "more-calls", "site-health", "custom-tools"] as const)[answers[1]];
}

export function guideUrl(site: string, guide: Guide): string {
  return `${site}/resources/${guide}.pdf`;
}

export function visitorEmail(site: string, guide: Guide): { subject: string; text: string; html: string } {
  const title = GUIDES[guide], url = guideUrl(site, guide);
  const offer = guide === "custom-tools"
    ? { line: "Want to talk it through? We'll tell you honestly whether a custom tool is worth it for you, in a free 20-minute call. No obligation.",
        link: `${site}/?offer=tool#contact`, label: "Book a free 20-minute call" }
    : { line: "Want a hand? We'll walk you through the 3 fixes that would get you more calls, in a free 20-minute review. No obligation.",
        link: `${site}/#contact`, label: "Book a free 20-minute review" };
  const footer = "You're getting this because this address was entered in the quiz at avellolabs.com. " +
    "If that wasn't you, you can ignore this email. We won't send anything else.";
  const text = [
    "Hi there,", "",
    `Thanks for taking the quiz. Your free guide is ready: ${title}`, "",
    "Open your free guide:", url, "",
    offer.line, `${offer.label}: ${offer.link}`, "",
    "Harris", "Avello Labs", "", footer,
  ].join("\n");

  // Email clients ignore most CSS, so the buttons are tables with inline styles. The main button has a solid
  // brand blue background for clients that drop the gradient, and dark text as on the site (contrast).
  const font = "Arial,Helvetica,sans-serif";
  const p = `style="margin:0 0 16px;font:16px/1.6 ${font};color:#1b2236"`;
  const button = (href: string, label: string, main: boolean) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${main ? ' width="100%"' : ""} style="border-collapse:separate${main ? ";max-width:360px" : ""}">
<tr><td align="center" bgcolor="${main ? "#4D74F2" : "#ffffff"}" style="border-radius:10px;${main
    ? "background:#4D74F2;background-image:linear-gradient(90deg,#4D74F2,#62AFF9,#22D3EE)"
    : "border:2px solid #4D74F2;background:#ffffff"}">
<a href="${href}" target="_blank" style="display:block;padding:${main ? "16px 28px" : "10px 18px"};font:bold ${main ? 18 : 15}px/1.3 ${font};color:${main ? "#061325" : "#0A1022"};text-decoration:none;border-radius:10px">${label}</a>
</td></tr></table>`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:24px 16px;background:#ffffff">
<div style="max-width:560px;margin:0 auto">
<p ${p}>Hi there,</p>
<p ${p}>Thanks for taking the quiz. Your free guide is ready:</p>
<p style="margin:0 0 20px;font:bold 20px/1.35 ${font};color:#0A1022">${title}</p>
${button(url, "Open your free guide", true)}
<p style="margin:12px 0 32px;font:13px/1.5 ${font};color:#55607a">Button not working? Copy this link: <a href="${url}" style="color:#4D74F2;word-break:break-all">${url}</a></p>
<p ${p}>${offer.line}</p>
${button(offer.link, offer.label, false)}
<p style="margin:32px 0 0;font:16px/1.6 ${font};color:#1b2236">Harris<br>Avello Labs</p>
<p style="margin:24px 0 0;font:13px/1.5 ${font};color:#55607a">${footer}</p>
</div></body></html>`;
  return { subject: `Your guide: ${title}`, text, html };
}

export function ownerEmail(a: { answers: number[]; guide: Guide; name: string; email: string; newsletter: boolean }): { subject: string; text: string } {
  const email = clean(a.email, 120);
  return {
    subject: `Quiz: ${email} got “${GUIDES[a.guide]}”`,
    text: [
      `Name: ${clean(a.name, 80) || "Not given"}`,
      `Email: ${email}`,
      `Newsletter: ${a.newsletter ? "yes, add them" : "no"}`,
      `Guide sent: ${GUIDES[a.guide]}`,
      "",
      ...QUESTIONS.map((q, i) => `${q.q}\n  ${q.a[a.answers[i]]}`),
      "",
      "Reply to this email to write to them.",
    ].join("\n"),
  };
}

export function quizAlert(a: { answers: number[]; guide: Guide; email: string; newsletter: boolean; sent: boolean }): string {
  return [
    "New quiz",
    `Email: ${clean(a.email, 120)}`,
    `When: ${QUESTIONS[4].a[a.answers[4]]}`,
    `Guide: ${GUIDES[a.guide]}`,
    `Newsletter: ${a.newsletter ? "yes" : "no"}`,
    `Guide email: ${a.sent ? "sent" : "FAILED, check Resend"}`,
  ].join("\n");
}

export const QUIZ_PAUSED_NOTICE =
  "Quiz emails are paused until tomorrow because today's limit was reached. Visitors can still download their guide on the page. If this keeps happening, someone may be abusing the quiz.";
