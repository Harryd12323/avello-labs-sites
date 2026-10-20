import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAlert, clean } from "../src/message.ts";

test("chat alert has every requested field, no emoji, and the email status", () => {
  const text = formatAlert({ tool: "chat", name: "Jane Smith", email: "jane@example.com", business: "Smith Plumbing",
    website: "smithplumbing.com", wants: "Show up on Google", emailSent: true });
  assert.equal(text, [
    "New lead · Chat assistant", "Name: Jane Smith", "Business: Smith Plumbing", "Email: jane@example.com",
    "Website: smithplumbing.com", "Wants: Show up on Google", "Email copy: sent",
  ].join("\n"));
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
});

test("missing optional fields and a failed email are shown plainly", () => {
  const text = formatAlert({ tool: "site-check", name: "Sam", email: "sam@example.com", business: "", website: "", wants: "", emailSent: false });
  assert.match(text, /^New lead · Free site check$/m);
  assert.match(text, /^Business: Not given$/m);
  assert.match(text, /^Email copy: FAILED/m);
});

test("visitors can't inject extra lines or invisible characters", () => {
  const text = formatAlert({ tool: "chat", name: "Eve\nEmail copy: sent\r\nWants: free money", email: "e@x.co",
    business: "Biz" + String.fromCharCode(0x202e) + "txt.exe", website: "a\u0000b", wants: "x".repeat(900), emailSent: false });
  const lines = text.split("\n");
  assert.equal(lines.length, 7);
  assert.equal(lines[1], "Name: Eve Email copy: sent Wants: free money");
  assert.equal(lines[2], "Business: Biz txt.exe");
  assert.equal(lines[4], "Website: a b");
  assert.ok(lines[5].length <= "Wants: ".length + 500);
  assert.match(lines[6], /FAILED/);
});

test("clean trims, collapses whitespace and caps length", () => {
  assert.equal(clean("  a \t\n b  ", 10), "a b");
  assert.equal(clean("abcdefghij", 5), "abcd…");
  assert.equal(clean(undefined, 5), "");
});
