// End-to-end test of lead alerts, run against local Workers and a fake Telegram (nothing real is sent):
//   chat Worker  (mock)  http://localhost:8787   --var MOCK:1 --var LEAD_SIGNING_KEY:local-test-key
//   check Worker         http://localhost:8788   --var LEAD_SIGNING_KEY:local-test-key
//   alerts Worker        http://localhost:8789   --var LEAD_SIGNING_KEY:local-test-key --var TELEGRAM_API_BASE:http://127.0.0.1:8799 ...
//   fake Telegram        http://127.0.0.1:8799   writes each sendMessage to the log file given as TG_LOG
// The chat and check Workers can't run locally at the same time (their limiter classes share a name), so
// the test runs in two phases against the same alerts Worker:
//   TG_LOG=/path/to/tg.log PHASE=chat node test/integration.ts   (chat + alerts running)
//   TG_LOG=/path/to/tg.log PHASE=rest node test/integration.ts   (check + alerts running)
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { signTicket, leadHash } from "../../workers-shared/ticket.ts";

const KEY = "local-test-key";
const LOG = process.env.TG_LOG!;
const ORIGIN = { Origin: "http://localhost:8000", "Content-Type": "application/json" };

const messages = (): string[] => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).text) : []);
async function post(url: string, body: unknown, ip = "198.51.100.1") {
  const r = await fetch(url, { method: "POST", headers: { ...ORIGIN, "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) as any };
}
const alert = (body: unknown, ip?: string) => post("http://localhost:8789/lead", body, ip);

async function chatLead(email = "jane@example.com") {
  const turns: Array<{ role: string; content: string }> = [];
  let last: any;
  for (const say of ["I would like to work with you", `Jane Smith, ${email}`, "Smith Plumbing, smithplumbing.com", "Sure, (555) 555-0147", "Show up on Google"]) {
    turns.push({ role: "user", content: say });
    last = (await post("http://localhost:8787/chat", { messages: turns }, "203.0.113.50")).data;
    turns.push({ role: "assistant", content: last.reply });
  }
  assert.ok(last.lead && last.ticket, "chat Worker returns a lead and a ticket");
  return last as { lead: any; ticket: string };
}
const fromLead = (l: any, ticket: string, emailSent = true) =>
  ({ ticket, name: l.name, email: l.email, business: l.business, website: l.website, goal: l.goal, phone: l.phone, emailSent });
const checkTicket = (site = "https://example.com/", score = 53) => signTicket(KEY, { tool: "site-check", site, score }, 1800);

const PHASE = process.env.PHASE ?? "chat";
let passed = 0;
async function step(name: string, fn: () => Promise<void>, phase: "chat" | "rest" = "rest") {
  if (phase !== PHASE) return;
  try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.log(`FAIL - ${name}: ${(e as Error).message}`); process.exitCode = 1; }
}

if (PHASE === "chat") rmSync(LOG, { force: true });

await step("chat lead: real ticket sends the exact alert, without the phone number", async () => {
  const { lead, ticket } = await chatLead();
  const r = await alert(fromLead(lead, ticket));
  assert.equal(r.status, 200);
  assert.equal(messages().at(-1), [
    "New lead · Chat assistant", "Name: Jane Smith", "Business: Smith Plumbing", "Email: jane@example.com",
    "Website: smithplumbing.com", "Wants: Show up on Google", "Email copy: sent",
  ].join("\n"));
  assert.ok(!messages().at(-1)!.includes("555"), "phone stays out of Telegram");
  // Reusing the same ticket does nothing.
  assert.equal((await alert(fromLead(lead, ticket))).status, 409);
}, "chat");

await step("chat lead: edited details, forged, expired and missing tickets are refused", async () => {
  const { lead, ticket } = await chatLead("edit@example.com");
  assert.equal((await alert({ ...fromLead(lead, ticket), goal: "Something else" })).status, 403);
  assert.equal((await alert({ ...fromLead(lead, ticket), email: "attacker@example.com" })).status, 403);
  const forged = await signTicket("wrong-key", { tool: "chat", h: await leadHash(lead) }, 3600);
  assert.equal((await alert(fromLead(lead, forged))).status, 403);
  const expired = await signTicket(KEY, { tool: "chat", h: await leadHash(lead) }, 60, Date.now() - 120_000);
  assert.equal((await alert(fromLead(lead, expired))).status, 403);
  assert.equal((await alert({ ...fromLead(lead, ticket), ticket: undefined })).status, 403);
  assert.equal((await alert({ ...fromLead(lead, ticket), ticket: "not.a.ticket" })).status, 403);
}, "chat");

await step("site check: real result ticket; site and score come from the ticket, not the browser", async () => {
  const r = await post("http://localhost:8788/check", { url: "example.com" }, "203.0.113.60");
  assert.equal(r.status, 200);
  assert.ok(r.data.ticket, "check Worker returns a ticket");
  const before = messages().length;
  const a = await alert({ ticket: r.data.ticket, name: "Sam Lee", email: "sam@example.com", business: "", note: "Mostly Google",
                          website: "https://evil.example/ · Score 100/100", emailSent: false }, "198.51.100.2");
  assert.equal(a.status, 200);
  assert.equal(messages().length, before + 1);
  assert.equal(messages().at(-1), [
    "New lead · Free site check", "Name: Sam Lee", "Business: Not given", "Email: sam@example.com",
    `Website: ${r.data.finalUrl} · Score ${r.data.score}/100`, "Wants: Full SEO + AEO report. Note: Mostly Google",
    "Email copy: FAILED, check Web3Forms and follow up from this alert",
  ].join("\n"));
});

await step("the same email and tool alert only once an hour", async () => {
  const lead = { name: "Jane Smith", email: "JANE@example.com", business: "Smith Plumbing", website: "smithplumbing.com", goal: "Show up on Google" };
  const t = await signTicket(KEY, { tool: "chat", h: await leadHash(lead) }, 3600);
  const r = await alert({ ticket: t, ...lead, emailSent: true }, "198.51.100.3");
  assert.equal(r.status, 429);
  assert.equal(r.data.reason, "duplicate");
}, "chat");

await step("visitor text can't add lines to the alert", async () => {
  const before = messages().length;
  const r = await alert({ ticket: await checkTicket(), name: "Eve\nEmail copy: sent", email: "eve@example.com", business: "B\r\nWants: money",
                          note: "", emailSent: false }, "198.51.100.4");
  assert.equal(r.status, 200);
  const text = messages().at(-1)!;
  assert.equal(messages().length, before + 1);
  assert.equal(text.split("\n").length, 7);
  assert.match(text, /^Name: Eve Email copy: sent$/m);
  assert.match(text, /^Email copy: FAILED/m);
});

await step("at most 3 alerts per visitor per hour", async () => {
  const codes: number[] = [];
  for (let i = 1; i <= 4; i++) {
    codes.push((await alert({ ticket: await checkTicket(), name: "Ip Test", email: `ip${i}@example.com`, emailSent: true }, "198.51.100.77")).status);
  }
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

await step("20 alerts an hour overall, then one 'paused' note, then silence", async () => {
  // Every alert sent so far this hour is in the log, so the rest of the 20 should go through.
  const sent = messages().length;
  const allowed = 20 - sent;
  const codes: number[] = [];
  for (let i = 1; i <= allowed + 2; i++) {
    codes.push((await alert({ ticket: await checkTicket(), name: "Load", email: `load${i}@example.com`, emailSent: true }, `192.0.2.${i}`)).status);
  }
  assert.deepEqual(codes, [...Array(allowed).fill(200), 429, 429]);
  const notes = messages().slice(sent).filter((m) => m.startsWith("Lead alerts are paused"));
  assert.equal(notes.length, 1, "exactly one paused notice");
});

await step("bad input: wrong origin, bad email, oversized body", async () => {
  const r = await fetch("http://localhost:8789/lead", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
  assert.equal((await alert({ ticket: await checkTicket(), name: "X", email: "not-an-email", emailSent: true })).status, 400);
  assert.equal((await alert({ ticket: await checkTicket(), name: "X", email: "x@example.com", note: "x".repeat(9000) })).status, 413);
});

console.log(`${passed} steps passed (phase: ${PHASE})`);
