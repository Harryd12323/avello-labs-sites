import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUESTIONS, GUIDES, parseAnswers, pickGuide, visitorEmail, ownerEmail, quizAlert, guideOwnerEmail, guideAlert } from "../src/quiz.ts";

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
  assert.ok(m.html.indexOf("Open your free guide") < m.html.indexOf("Book a free 20-minute review"), "guide button comes first");
  assert.equal(m.html.split('href="https://avellolabs.com/resources/get-found.pdf"').length - 1, 2, "button plus plain fallback link");
  const tool = visitorEmail(SITE, "custom-tools");
  assert.ok(tool.text.includes("https://avellolabs.com/?offer=tool#contact"));
  for (const t of [m.text, m.html, tool.text]) assert.doesNotMatch(t, /[–—]/); // no en or em dashes
});

test("the guide email only offers the tips with a confirm link, and says nothing is sent without it", () => {
  const plain = visitorEmail(SITE, "get-found"), tips = visitorEmail(SITE, "get-found", "https://w.example/tips/confirm?t=abc");
  assert.ok(plain.text.includes("We won't send anything else."));
  assert.doesNotMatch(plain.text + plain.html, /tips/);
  assert.ok(tips.text.includes("Yes, send me the tips: https://w.example/tips/confirm?t=abc"));
  assert.ok(tips.html.includes('href="https://w.example/tips/confirm?t=abc"'));
  assert.ok(tips.text.includes("The tips only start if you tap"));
  assert.ok(tips.html.indexOf("Open your free guide") < tips.html.indexOf("Yes, send me the tips"), "guide button comes first");
  assert.doesNotMatch(tips.text + tips.html, /[–—]/);
});

test("Harris's copy lists every answer in words and cleans what the visitor typed", () => {
  const m = ownerEmail({ answers: [1, 0, 1, 0, 1], guide: "get-found", name: "Eve\nNewsletter: yes", email: "eve@example.com", newsletter: false, tips: true, stopUrl: "https://w.example/tips/stop-one?t=s" });
  assert.match(m.text, /^Name: Eve Newsletter: yes$/m);
  assert.match(m.text, /^Newsletter: no$/m);
  assert.match(m.text, /^Tip emails: yes/m);
  assert.match(m.text, /^Stop their tip emails .*: https:\/\/w\.example\/tips\/stop-one\?t=s$/m);
  assert.match(m.text, /^ {2}People can't find us on Google or in AI answers$/m);
  assert.match(m.text, /^ {2}Yes, but it's old or I don't like it$/m);
  assert.match(m.text, /^When do you want this sorted\?\n {2}In the next month or two$/m);
  assert.match(m.subject, /eve@example\.com/);
});

test("the Telegram alert says when they want it sorted and whether the guide email went out", () => {
  assert.match(quizAlert({ answers: [1, 2, 1, 0, 0], guide: "site-health", email: "a@b.co", newsletter: true, tips: false, sent: false }), /^Guide email: FAILED/m);
  const text = quizAlert({ answers: [1, 2, 1, 0, 0], guide: "site-health", email: "a@b.co", newsletter: true, tips: true, sent: true });
  assert.match(text, /^When: ASAP$/m);
  assert.match(text, /^Newsletter: yes$/m);
  assert.match(text, /^Tips: yes$/m);
});

test("a guide asked for on a problem page gets its own wording, and Harris sees which page", () => {
  const m = visitorEmail(SITE, "more-calls", undefined, "page");
  assert.ok(m.text.includes("Thanks for asking for our free guide. Here it is: A website that turns visitors into calls"));
  assert.ok(m.text.includes("entered on avellolabs.com"));
  assert.doesNotMatch(m.text + m.html, /quiz/);
  const o = guideOwnerEmail({ guide: "more-calls", page: "/no-calls/", name: "", email: "x@y.co", newsletter: false, tips: false });
  assert.match(o.text, /^Page: \/no-calls\/$/m);
  assert.match(o.subject, /^Guide request: x@y\.co/);
  assert.match(guideAlert({ guide: "more-calls", page: "/no-calls/", email: "x@y.co", newsletter: false, tips: true, sent: true }), /^Tips: yes$/m);
});

test("every problem page offers a guide the Worker knows", () => {
  const dir = new URL("../../scripts/problems/", import.meta.url);
  for (const file of ["cant-find-us.txt", "no-calls.txt", "too-much-admin.txt"]) {
    const guide = readFileSync(new URL(file, dir), "utf8").match(/^Resource: ([a-z-]+)/m)?.[1];
    assert.ok(guide && guide in GUIDES, file);
  }
});
