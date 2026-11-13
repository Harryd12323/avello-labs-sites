import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUESTIONS, GUIDES, parseAnswers, pickGuide, visitorEmail, ownerEmail, quizAlert } from "../src/quiz.ts";

const SITE = "https://avellolabs.com";

test("answers must be one valid index per question", () => {
  assert.deepEqual(parseAnswers([1, 0, 1, 0, 2]), [1, 0, 1, 0, 2]);
  assert.equal(parseAnswers([1, 0, 1, 0]), null);
  assert.equal(parseAnswers([1, 0, 1, 0, 0, 0]), null);
  assert.equal(parseAnswers([3, 0, 1, 0, 0]), null); // question 1 has three answers
  assert.equal(parseAnswers([1, 0, 1, 0, 3]), null); // so does question 5
  assert.equal(parseAnswers([1, 0.5, 1, 0, 0]), null);
  assert.equal(parseAnswers(["1", 0, 1, 0, 0]), null);
  assert.equal(parseAnswers("1,0,1,0,0"), null);
});

test("no website means the website guide; otherwise the biggest problem decides", () => {
  assert.equal(pickGuide([0, 0, 0, 0, 0]), "more-calls");
  assert.equal(pickGuide([0, 3, 3, 0, 1]), "more-calls");
  assert.equal(pickGuide([1, 0, 1, 0, 2]), "get-found");
  assert.equal(pickGuide([2, 1, 0, 2, 0]), "more-calls");
  assert.equal(pickGuide([2, 2, 1, 0, 1]), "site-health");
  assert.equal(pickGuide([1, 3, 3, 3, 2]), "custom-tools");
});

test("every guide has a built PDF", () => {
  for (const guide of Object.keys(GUIDES)) {
    assert.ok(readFileSync(new URL(`../../resources/${guide}.pdf`, import.meta.url)).length > 1000, guide);
  }
});

test("the site's quiz script asks the same questions and picks the same way", () => {
  const js = readFileSync(new URL("../../assets/quiz.js", import.meta.url), "utf8");
  for (const { q, a } of QUESTIONS) {
    assert.ok(js.includes(JSON.stringify(q)), q);
    for (const answer of a) assert.ok(js.includes(JSON.stringify(answer)), answer);
  }
  assert.match(js, /\["get-found", "more-calls", "site-health", "custom-tools"\]/);
});

test("the visitor's email links their guide and the right offer, and contains nothing they typed", () => {
  const m = visitorEmail(SITE, "get-found");
  assert.equal(m.subject, "Your guide: Get found on Google and in AI answers");
  assert.ok(m.text.includes("https://avellolabs.com/resources/get-found.pdf"));
  assert.ok(m.html.includes('href="https://avellolabs.com/resources/get-found.pdf"'));
  assert.ok(m.text.includes("https://avellolabs.com/#contact"));
  const tool = visitorEmail(SITE, "custom-tools");
  assert.ok(tool.text.includes("https://avellolabs.com/?offer=tool#contact"));
  for (const t of [m.text, m.html, tool.text]) assert.doesNotMatch(t, /[–—]/); // no en or em dashes
});

test("Harris's copy lists every answer in words and cleans what the visitor typed", () => {
  const m = ownerEmail({ answers: [1, 0, 1, 0, 1], guide: "get-found", name: "Eve\nNewsletter: yes", email: "eve@example.com", newsletter: false });
  assert.match(m.text, /^Name: Eve Newsletter: yes$/m);
  assert.match(m.text, /^Newsletter: no$/m);
  assert.match(m.text, /^ {2}People can't find us on Google or in AI answers$/m);
  assert.match(m.text, /^ {2}Yes, but it's old or I don't like it$/m);
  assert.match(m.text, /^When do you want this sorted\?\n {2}In the next month or two$/m);
  assert.match(m.subject, /eve@example\.com/);
});

test("the Telegram alert says when they want it sorted and whether the guide email went out", () => {
  assert.match(quizAlert({ answers: [1, 2, 1, 0, 0], guide: "site-health", email: "a@b.co", newsletter: true, sent: false }), /^Guide email: FAILED/m);
  const text = quizAlert({ answers: [1, 2, 1, 0, 0], guide: "site-health", email: "a@b.co", newsletter: true, sent: true });
  assert.match(text, /^When: ASAP$/m);
  assert.match(text, /^Newsletter: yes$/m);
});
