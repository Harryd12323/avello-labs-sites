import { test } from "node:test";
import assert from "node:assert/strict";
import { signTicket, verifyTicket, leadHash, CHAT_TICKET_SECONDS } from "./ticket.ts";

const KEY = "test-signing-key";
const lead = { name: "Jane Smith", email: "jane@example.com", business: "Smith Plumbing", website: "smithplumbing.com", goal: "Show up on Google" };

test("a signed chat ticket verifies and carries the lead hash", async () => {
  const h = await leadHash(lead);
  const t = await signTicket(KEY, { tool: "chat", h }, CHAT_TICKET_SECONDS);
  const p = await verifyTicket(KEY, t);
  assert.ok(p && p.tool === "chat");
  assert.equal(p.h, h);
});

test("a check ticket carries the site and score", async () => {
  const t = await signTicket(KEY, { tool: "site-check", site: "https://example.com/", score: 53 }, 1800);
  const p = await verifyTicket(KEY, t);
  assert.ok(p && p.tool === "site-check");
  assert.equal(p.site, "https://example.com/");
  assert.equal(p.score, 53);
});

test("wrong key, tampering, expiry and junk are rejected", async () => {
  const t = await signTicket(KEY, { tool: "site-check", site: "https://example.com/", score: 53 }, 1800);
  assert.equal(await verifyTicket("other-key", t), null);
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), score: 100 })).toString("base64url");
  assert.equal(await verifyTicket(KEY, `${forged}.${sig}`), null);
  assert.equal(await verifyTicket(KEY, t.slice(0, -2) + "xx"), null);
  const old = await signTicket(KEY, { tool: "chat", h: "x" }, 60, Date.now() - 61_000);
  assert.equal(await verifyTicket(KEY, old), null);
  for (const junk of ["", "abc", "a.b.c", "a.b", "x".repeat(2000)]) assert.equal(await verifyTicket(KEY, junk), null);
});

test("the lead hash changes when any alert field changes, but not with email case", async () => {
  const h = await leadHash(lead);
  assert.equal(await leadHash({ ...lead, email: "JANE@example.com" }), h);
  for (const k of ["name", "business", "website", "goal", "email"] as const) {
    assert.notEqual(await leadHash({ ...lead, [k]: lead[k] + "x" }), h, k);
  }
});

test("a newsletter ticket carries its issue time", async () => {
  const now = Date.now();
  const t = await signTicket(KEY, { tool: "newsletter", iat: Math.floor(now / 1000) }, 7200, now);
  const p = await verifyTicket(KEY, t);
  assert.ok(p && p.tool === "newsletter");
  assert.equal(p.iat, Math.floor(now / 1000));
  assert.equal(await verifyTicket(KEY, await signTicket(KEY, { tool: "newsletter" } as never, 7200)), null, "iat is required");
});
