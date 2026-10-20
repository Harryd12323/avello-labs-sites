// End-to-end test of newsletter signup alerts, run against local Workers and a fake Telegram (nothing real
// is sent): the check Worker on :8788 and the alerts Worker on :8789, both with LEAD_SIGNING_KEY local-test-key,
// and the alerts Worker pointed at a fake Telegram that logs to TG_LOG. Start with fresh alerts state.
//   TG_LOG=/path/to/tg.log node test/newsletter.ts
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { signTicket } from "../../workers-shared/ticket.ts";

const KEY = "local-test-key";
const LOG = process.env.TG_LOG!;
const H = { Origin: "http://localhost:8000", "Content-Type": "application/json" };
const messages = (): string[] => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).text) : []);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function post(url: string, body: unknown, ip = "198.51.100.10") {
  const r = await fetch(url, { method: "POST", headers: { ...H, "CF-Connecting-IP": ip }, body: JSON.stringify(body) });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as any };
}
const signup = (body: unknown, ip?: string) => post("http://localhost:8789/lead", body, ip);
// A ticket issued a few seconds ago, so it passes the "too fast" rule.
const oldTicket = async () => signTicket(KEY, { tool: "newsletter", iat: Math.floor(Date.now() / 1000) - 5 }, 7200);

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.log(`FAIL - ${name}: ${(e as Error).message}`); process.exitCode = 1; }
}

await step("real ticket: too fast is refused, after 3 seconds it sends the exact alert, reuse is refused", async () => {
  const t = await post("http://localhost:8788/ticket/newsletter", {});
  assert.equal(t.status, 200);
  const body = { ticket: t.data.ticket, name: "Sam Lee", email: "sam@example.com", page: "/tools/schema-generator/", consent: true, emailSent: true };
  const fast = await signup(body);
  assert.equal(fast.status, 429);
  assert.equal(fast.data.reason, "too_fast");
  await wait(3200);
  const before = messages().length;
  assert.equal((await signup(body)).status, 200);
  assert.equal(messages().length, before + 1);
  assert.equal(messages().at(-1), "New newsletter signup\nName: Sam Lee\nEmail: sam@example.com\nPage: /tools/schema-generator/\nEmail copy: sent");
  assert.equal((await signup(body)).status, 409);
});

await step("consent, email and ticket are required", async () => {
  assert.equal((await signup({ ticket: await oldTicket(), email: "a@example.com", page: "/", emailSent: true })).status, 400);
  assert.equal((await signup({ ticket: await oldTicket(), email: "a@example.com", page: "/", consent: "yes", emailSent: true })).status, 400);
  assert.equal((await signup({ ticket: await oldTicket(), email: "not-an-email", page: "/", consent: true })).status, 400);
  assert.equal((await signup({ email: "a@example.com", page: "/", consent: true })).status, 403);
  const forged = await signTicket("wrong-key", { tool: "newsletter", iat: 1 }, 7200);
  assert.equal((await signup({ ticket: forged, email: "a@example.com", page: "/", consent: true })).status, 403);
});

await step("the same email only alerts once in 24 hours", async () => {
  const r = await signup({ ticket: await oldTicket(), email: "SAM@example.com", page: "/", consent: true, emailSent: true }, "198.51.100.11");
  assert.equal(r.status, 429);
  assert.equal(r.data.reason, "duplicate");
});

await step("at most 3 signup alerts per visitor per hour", async () => {
  const codes: number[] = [];
  for (let i = 1; i <= 4; i++) {
    codes.push((await signup({ ticket: await oldTicket(), email: `ip${i}@example.com`, page: "/", consent: true, emailSent: true }, "198.51.100.12")).status);
  }
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

await step("15 signup alerts a day, then one 'paused' note, then silence", async () => {
  const sent = messages().filter((m) => m.startsWith("New newsletter signup")).length; // 4 so far
  const allowed = 15 - sent;
  const codes: number[] = [];
  for (let i = 1; i <= allowed + 2; i++) {
    codes.push((await signup({ ticket: await oldTicket(), email: `day${i}@example.com`, page: "/", consent: true, emailSent: true }, `192.0.2.${i}`)).status);
  }
  assert.deepEqual(codes, [...Array(allowed).fill(200), 429, 429]);
  assert.equal(messages().filter((m) => m.startsWith("Newsletter signup alerts are paused")).length, 1);
});

await step("lead alerts have their own limits and still work while signups are capped", async () => {
  const t = await signTicket(KEY, { tool: "site-check", site: "https://example.com/", score: 53 }, 1800);
  const r = await signup({ ticket: t, name: "Lead Test", email: "lead@example.com", emailSent: true }, "198.51.100.13");
  assert.equal(r.status, 200);
  assert.match(messages().at(-1)!, /^New lead · Free site check/);
});

console.log(`${passed} steps passed`);
