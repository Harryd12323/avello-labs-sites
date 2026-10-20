import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, evaluate, ruleMatches } from "../src/robots.ts";
import { BOTS } from "../src/bots.ts";

const can = (txt: string, token: string, path = "/") => evaluate(parseRobots(txt), token, path).allowed;

test("no robots rules at all: everything allowed", () => {
  assert.equal(can("", "GPTBot"), true);
  assert.equal(can("# just a comment\nSitemap: https://x.com/s.xml", "GPTBot"), true);
});

test("a bot's own group beats the * group (RFC 9309)", () => {
  const txt = "User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /\n";
  assert.equal(can(txt, "OAI-SearchBot"), true);
  assert.equal(can(txt, "GPTBot"), false);
});

test("user-agent matching is case-insensitive and groups for the same bot combine", () => {
  const txt = "User-agent: gptbot\nDisallow: /private/\n\nUser-agent: GPTBOT\nDisallow: /\n";
  assert.equal(can(txt, "GPTBot"), false);
  const v = evaluate(parseRobots(txt), "GPTBot", "/");
  assert.equal(v.rule, "Disallow: /");
});

test("several user-agent lines share one group", () => {
  const txt = "User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n";
  for (const t of ["GPTBot", "ClaudeBot", "CCBot"]) assert.equal(can(txt, t), false, t);
  for (const t of ["OAI-SearchBot", "PerplexityBot", "Googlebot"]) assert.equal(can(txt, t), true, t);
});

test("a user-agent line after rules starts a new group", () => {
  const txt = "User-agent: GPTBot\nDisallow: /\nUser-agent: PerplexityBot\nAllow: /\n";
  assert.equal(can(txt, "GPTBot"), false);
  assert.equal(can(txt, "PerplexityBot"), true);
});

test("longest match wins, and Allow wins a tie", () => {
  assert.equal(can("User-agent: *\nDisallow: /\nAllow: /$\n", "GPTBot", "/"), true);
  assert.equal(can("User-agent: *\nDisallow: /\nAllow: /$\n", "GPTBot", "/page"), false);
  assert.equal(can("User-agent: *\nAllow: /shop\nDisallow: /shop/cart\n", "GPTBot", "/shop/cart/1"), false);
  assert.equal(can("User-agent: *\nDisallow: /a\nAllow: /a\n", "GPTBot", "/a"), true);
});

test("wildcards and end anchors", () => {
  assert.equal(ruleMatches("/*.pdf$", "/files/menu.pdf"), true);
  assert.equal(ruleMatches("/*.pdf$", "/files/menu.pdf?x=1"), false);
  assert.equal(ruleMatches("/blog*/draft", "/blog/2026/draft"), true);
  assert.equal(ruleMatches("/a.b", "/axb"), false); // "." is literal
  assert.equal(can("User-agent: *\nDisallow: /*?\n", "GPTBot", "/page?x=1"), false);
});

test("empty Disallow means allow everything; junk lines, comments and BOM are tolerated", () => {
  assert.equal(can("User-agent: GPTBot\nDisallow:\n", "GPTBot"), true);
  assert.equal(can(String.fromCharCode(0xfeff) + "User-agent: GPTBot\r\nDisallow: / # all of it\r\n", "GPTBot"), false);
  assert.equal(can("this is not robots\nUser-agent: *\nnonsense\nDisallow: /\n", "GPTBot"), false);
  assert.equal(can("Disallow: /\nUser-agent: *\nAllow: /\n", "GPTBot"), true); // rules before any group are ignored
});

test("Sitemap lines between user-agent lines don't split the group (as in Google's parser)", () => {
  const txt = "User-agent: GPTBot\nSitemap: https://x.com/s.xml\nUser-agent: ClaudeBot\nDisallow: /\n";
  assert.equal(can(txt, "ClaudeBot"), false);
  assert.equal(can(txt, "GPTBot"), false);
});

test("the bot list has unique tokens, a category, a description and an https docs link", () => {
  const tokens = BOTS.map((b) => b.token.toLowerCase());
  assert.equal(new Set(tokens).size, tokens.length);
  for (const b of BOTS) {
    assert.ok(b.what.length > 20 && b.docs.startsWith("https://") && b.company, b.token);
    assert.ok(["ai-search", "user", "training", "token", "search"].includes(b.category), b.token);
  }
});
