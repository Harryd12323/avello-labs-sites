import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TIPS, TIP5_TOOL, greeting, renderTip, renderConfirm, atLocalHour, dueAt, OFFSET_DAYS, signLink, verifyLink, newId,
  verifyWebhook, replyId, replyAddress, parseBackfill, isAutoReply, backfillKey } from "../src/tips.ts";
import { BANNED } from "./banned.ts";

const DAY = 86_400_000;
const live = { dayMs: DAY, sendHour: 10 };

test("greeting uses a real first name and falls back to Hi there", () => {
  assert.equal(greeting("jane smith"), "Hi Jane,");
  assert.equal(greeting("  Anne-Marie  "), "Hi Anne-Marie,");
  assert.equal(greeting("O'Neil"), "Hi O'Neil,");
  assert.equal(greeting("José"), "Hi José,");
  for (const bad of ["", "J", "x1", "bob@example.com", "www.site.com", "<b>", "Aaaaaaaaaaaaaaaaaaaaaaaa", "Jane\nNewsletter"])
    assert.ok(["Hi there,", "Hi Jane,"].includes(greeting(bad)), bad);
  assert.equal(greeting("bob@example.com"), "Hi there,");
  assert.equal(greeting("Jane\nNewsletter: yes"), "Hi Jane,");
});

test("each tip has the greeting, an unsubscribe link, the address, and follows the copy rules", () => {
  for (let step = 0; step < 5; step++) {
    for (const guide of ["get-found", "custom-tools"] as const) {
      const m = renderTip(step, { site: "https://avellolabs.com", name: "jane", guide, unsubscribeUrl: "https://w.example/tips/unsubscribe?t=u1" });
      assert.ok(m.text.startsWith("Hi Jane,\n"), `${step} ${guide}`);
      assert.ok(m.html.includes('href="https://w.example/tips/unsubscribe?t=u1"'));
      assert.ok(m.text.includes("https://w.example/tips/unsubscribe?t=u1"));
      assert.ok(m.text.includes("PO Box 141") && m.html.includes("PO Box 141"));
      const prose = (m.subject + "\n" + m.text).toLowerCase();
      assert.doesNotMatch(prose, /[–—]| - /);
      assert.doesNotMatch(m.text, /"/, "curly double quotes only");
      for (const w of BANNED) assert.ok(!new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(prose), `${w} in tip ${step + 1}`);
      assert.doesNotMatch(prose, /guarantee|first page|overnight/);
    }
  }
});

test("email 5 offers the review, or the tool call to people who got the custom tools guide", () => {
  const args = { site: "https://avellolabs.com", name: "", unsubscribeUrl: "https://w.example/u" };
  const review = renderTip(4, { ...args, guide: "get-found" }), tool = renderTip(4, { ...args, guide: "custom-tools" });
  assert.ok(review.text.includes("Book your free review: https://avellolabs.com/#contact"));
  assert.ok(review.text.includes("the 3 fixes I'd tackle first"));
  assert.ok(tool.text.includes("Book your free call: https://avellolabs.com/?offer=tool#contact"));
  assert.equal(tool.subject, TIP5_TOOL.subject);
  assert.ok(review.text.startsWith("Hi there,"));
});

test("the tip copy matches the approved drafts in docs/", () => {
  const doc = readFileSync(new URL("../../docs/quiz-followup-emails.md", import.meta.url), "utf8");
  for (const tip of [...TIPS, TIP5_TOOL]) {
    assert.ok(doc.includes(`**Subject:** ${tip.subject}`), tip.subject);
    for (const para of tip.body.split("\n\n").filter((p) => p !== "{cta}")) assert.ok(doc.includes(para), para.slice(0, 60));
  }
});

test("the confirm email has one button and says nothing more comes without it", () => {
  const m = renderConfirm({ name: "sam", confirmUrl: "https://w.example/tips/confirm?t=c1" });
  assert.ok(m.text.startsWith("Hi Sam,"));
  assert.ok(m.html.includes('href="https://w.example/tips/confirm?t=c1"'));
  assert.ok(m.text.includes("we won't send anything else"));
});

test("tips go out at 10am New York time, on the planned days", () => {
  // Nov 15, 2026, 3pm in New York (EST, UTC-5) = 20:00 UTC.
  const guide = Date.UTC(2026, 10, 15, 20);
  const first = dueAt(0, guide, guide + 60_000, null, live);
  assert.equal(new Date(first).toISOString(), "2026-11-18T15:00:00.000Z"); // 2 days later, then the next 10am
  // Summer time (EDT, UTC-4): 10am is 14:00 UTC.
  assert.equal(new Date(atLocalHour(Date.UTC(2026, 6, 1, 3), 10)).toISOString(), "2026-07-01T14:00:00.000Z");
  assert.equal(new Date(atLocalHour(Date.UTC(2026, 6, 1, 14), 10)).toISOString(), "2026-07-01T14:00:00.000Z");
});

test("a late confirmation sends the first tip soon, then keeps at least 2 days between tips", () => {
  const guide = Date.UTC(2026, 10, 15, 20);
  const confirmed = guide + 6 * DAY;
  const first = dueAt(0, guide, confirmed, null, live);
  assert.ok(first >= confirmed && first < confirmed + DAY);
  const second = dueAt(1, guide, first, first, live);
  assert.ok(second >= first + 2 * DAY);
  // On time: every tip on its planned day.
  let prev: number | null = null;
  for (let s = 0; s < 5; s++) {
    const at: number = dueAt(s, guide, prev ?? guide, prev, live);
    assert.equal(Math.floor((at - guide) / DAY), OFFSET_DAYS[s], `tip ${s + 1}`);
    prev = at;
  }
});

test("in the test run a day is a minute and tips go out as soon as they're due", () => {
  const cfg = { dayMs: 60_000, sendHour: null };
  assert.equal(dueAt(0, 0, 30_000, null, cfg), 120_000);
  assert.equal(dueAt(4, 0, 1_000_000, 1_000_000, cfg), 1_260_000);
});

test("signed links only work for their own kind and can't be edited", async () => {
  const id = newId();
  assert.match(id, /^[0-9a-f]{24}$/);
  const t = await signLink("k1", "u", id);
  assert.equal(await verifyLink("k1", "u", t), id);
  assert.equal(await verifyLink("k1", "c", t), null);
  assert.equal(await verifyLink("k2", "u", t), null);
  const [body, sig] = t.split(".");
  const forged = btoa(JSON.stringify({ k: "u", id: "0".repeat(24) })).replace(/=+$/, "");
  assert.equal(await verifyLink("k1", "u", `${forged}.${sig}`), null);
  assert.equal(await verifyLink("k1", "u", `${body}.${sig}x`), null);
  assert.equal(await verifyLink("k1", "u", null), null);
});

test("Resend webhooks are checked the Svix way and expire after 5 minutes", async () => {
  const key = crypto.getRandomValues(new Uint8Array(24));
  const secret = "whsec_" + btoa(String.fromCharCode(...key));
  const body = '{"type":"email.received"}', id = "msg_1", now = Date.UTC(2026, 10, 15);
  const ts = String(now / 1000);
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${body}`)))));
  const h = { id, timestamp: ts, signature: `v1,bogus v1,${sig}` };
  assert.equal(await verifyWebhook(secret, h, body, now), true);
  assert.equal(await verifyWebhook(secret, h, body + " ", now), false);
  assert.equal(await verifyWebhook(secret, h, body, now + 301_000), false);
  assert.equal(await verifyWebhook(secret, { ...h, signature: `v1,${sig.slice(1)}` }, body, now), false);
  assert.equal(await verifyWebhook(secret, { ...h, id: null }, body, now), false);
});

test("reply addresses carry the subscriber ID, and the live and test Workers ignore each other's", () => {
  const id = "0123456789abcdef01234567";
  const addr = replyAddress("replies", "send.avellolabs.com", id);
  assert.equal(addr, "replies+0123456789abcdef01234567@send.avellolabs.com");
  assert.equal(replyId(["harris@avellolabs.com", `Avello <${addr}>`], "replies", "send.avellolabs.com"), id);
  assert.equal(replyId([addr.toUpperCase()], "replies", "send.avellolabs.com"), id);
  assert.equal(replyId([addr], "replies-test", "send.avellolabs.com"), null);
  assert.equal(replyId([replyAddress("replies-test", "send.avellolabs.com", id)], "replies", "send.avellolabs.com"), null);
  assert.equal(replyId(["replies+xyz@send.avellolabs.com", 42], "replies", "send.avellolabs.com"), null);
});

test("backfill lines are email | name | guide, with bad lines skipped", () => {
  assert.deepEqual(parseBackfill("a@b.co | Ann | get-found\nnot an email\nc@d.co||Stop doing it by hand\ne@f.co"), [
    { email: "a@b.co", name: "Ann", guide: "get-found" },
    { email: "c@d.co", name: "", guide: "custom-tools" },
    { email: "e@f.co", name: "", guide: "more-calls" },
  ]);
});

test("out-of-office notes and bounces don't count as replies, but real replies and unsubscribes do", () => {
  for (const [from, subject] of [["a@b.co", "Automatic reply: One quick fix"], ["a@b.co", "Out of Office: back Monday"], ["a@b.co", "Auto-Reply: thanks"],
    ["MAILER-DAEMON@mx.example.com", "Re: tip"], ["no-reply@b.co", "Re: tip"], ["a@b.co", "Undeliverable: One quick fix"], ["a@b.co", "I'm on vacation"]]) {
    assert.equal(isAutoReply(from, subject), true, subject);
  }
  for (const [from, subject] of [["a@b.co", "Re: One quick fix: can people call you in one tap?"], ["a@b.co", "unsubscribe"], ["Jane <jane@b.co>", "Question about tip 3"]]) {
    assert.equal(isAutoReply(from, subject), false, subject);
  }
});

test("the backfill key is the start of the list's hash, ignoring surrounding whitespace", async () => {
  const k = await backfillKey("a@b.co | Ann | get-found");
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(await backfillKey("  a@b.co | Ann | get-found\n"), k);
  assert.notEqual(await backfillKey("a@b.co | Ann | more-calls"), k);
});
