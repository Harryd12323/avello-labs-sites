// Fixture tests for the HTML reader, run against a local `wrangler dev --var TEST:1` (port 8788).
// They use the test-only /__test/analyze route, which scores supplied HTML without fetching anything.
//   node test/fixtures.mjs
import assert from "node:assert/strict";

const BASE = process.env.CHECK_URL ?? "http://localhost:8788";
async function analyze(html, site = {}) {
  const res = await fetch(`${BASE}/__test/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:8000" },
    body: JSON.stringify({ html, site }),
  });
  assert.equal(res.status, 200, "test route should be enabled with --var TEST:1");
  return res.json();
}
const status = (r, id) => r.report.checks.find((c) => c.id === id).status;

const cases = [
  ["a complete page", `<!doctype html><html><head><title>Emergency Plumber in Town | Smith &amp; Sons</title>
    <meta name="description" content="24/7 emergency plumbing in Cherry Hill and nearby towns. Licensed, insured, upfront prices, same-day service.">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Smith"}</script></head>
    <body><h1>Plumbing</h1><p>${"Real text. ".repeat(60)}</p><img src="a.jpg" alt="Van"><img src="b.jpg" alt=""></body></html>`,
    (r) => {
      assert.equal(r.page.title, "Emergency Plumber in Town | Smith & Sons");
      assert.equal(r.page.imgTotal, 2); assert.equal(r.page.imgMissingAlt, 0);
      assert.equal(r.report.score, 100);
    }],
  ["SVG titles in the body aren't the page title", `<html><head><title>Real Title For The Page</title></head><body><svg><title>icon</title></svg><h1>x</h1></body></html>`,
    (r) => assert.equal(r.page.title, "Real Title For The Page")],
  ["no head tags at all", `<html><body><p>hello</p></body></html>`,
    (r) => { for (const id of ["title", "description", "viewport", "h1", "schema"]) assert.equal(status(r, id), "fail", id); }],
  ["multiple H1s and missing alt", `<html><head><title>Okay Title Here</title></head><body><h1>a</h1><h1>b</h1><img src=x><img src=y><img src=z alt="z"></body></html>`,
    (r) => { assert.equal(r.page.h1Count, 2); assert.equal(status(r, "h1"), "warn"); assert.equal(r.page.imgMissingAlt, 2); assert.equal(status(r, "alt"), "fail"); }],
  ["noindex meta tag", `<html><head><meta name="ROBOTS" content="noindex,nofollow"></head><body></body></html>`,
    (r) => assert.equal(status(r, "indexable"), "fail")],
  ["noindex header", `<html><head></head><body></body></html>`,
    (r) => assert.equal(status(r, "indexable"), "fail"), { xRobotsTag: "noindex" }],
  ["schema in an @graph with several blocks, one broken", `<html><head>
    <script type="application/ld+json">{ broken </script>
    <script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Dentist"]}]}</script></head><body></body></html>`,
    (r) => { assert.equal(r.page.jsonLd.length, 2); assert.equal(status(r, "schema"), "pass"); }],
  ["microdata business type", `<html><body><div itemscope itemtype="https://schema.org/HairSalon"></div></body></html>`,
    (r) => assert.equal(status(r, "schema"), "pass")],
  ["JavaScript app shell gets the note", `<html><head><title>App</title></head><body><div id="root"></div><script src=a.js></script></body></html>`,
    (r) => assert.equal(r.report.notes.length, 1)],
  ["entities and whitespace in the description", `<html><head><meta name="description" content="Caf&eacute;s &amp; bakeries &#8211; fresh   daily in town, with   delivery and catering for events of every size."></head></html>`,
    (r) => assert.ok(r.page.metaDescription.includes("&") && r.page.metaDescription.includes("–"))],
];

let failed = 0;
for (const [name, html, check, site] of cases) {
  try {
    check(await analyze(html, site));
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}: ${e.message}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} fixture tests passed`);
process.exit(failed ? 1 : 0);
