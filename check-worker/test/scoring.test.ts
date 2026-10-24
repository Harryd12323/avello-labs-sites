import { test } from "node:test";
import assert from "node:assert/strict";
import { score, schemaTypes, parseRobots, type PageFacts, type SiteFacts } from "../src/scoring.ts";

const goodPage: PageFacts = {
  title: "Emergency Plumber in Cherry Hill, NJ | Smith Plumbing",
  metaDescription: "24/7 emergency plumbing in Cherry Hill and nearby towns. Licensed, insured, upfront prices. Call for same-day service.",
  robotsMeta: [], viewport: "width=device-width, initial-scale=1", h1Count: 1,
  jsonLd: [JSON.stringify({ "@context": "https://schema.org", "@type": "Plumber", name: "Smith Plumbing" })], itemTypes: [],
  imgTotal: 4, imgMissingAlt: 0, textChars: 4000, scriptCount: 2, appRoot: false,
};
const goodSite: SiteFacts = {
  finalUrl: "https://smithplumbing.example/", finalHttps: true, httpRedirectsToHttps: true, xRobotsTag: null,
  htmlBytes: 40_000, truncated: false, robots: { found: true, blocksAll: false, sitemaps: [] }, sitemap: { found: true, valid: true },
};
const by = (r: ReturnType<typeof score>, id: string) => r.checks.find((c) => c.id === id)!;

test("a well-built page scores 100 with no fixes", () => {
  const r = score(goodPage, goodSite);
  assert.equal(r.score, 100);
  assert.equal(r.checks.length, 10);
  assert.ok(r.checks.every((c) => c.status === "pass" && c.fix === ""));
  assert.deepEqual(r.notes, []);
});

test("an empty page fails nearly everything, each failure with a fix", () => {
  const r = score({ ...goodPage, title: null, metaDescription: null, viewport: null, h1Count: 0, jsonLd: [], imgTotal: 5, imgMissingAlt: 5 },
                  { ...goodSite, finalHttps: false, robots: { found: false, blocksAll: false, sitemaps: [] }, sitemap: { found: false, valid: false } });
  for (const id of ["https", "title", "description", "viewport", "h1", "schema", "crawl", "alt"]) {
    assert.equal(by(r, id).status, "fail", id);
    assert.ok(by(r, id).fix.length > 20, `${id} has a fix`);
  }
  assert.equal(r.score, 20); // only "Allowed in Google" (15) and page size (5) pass
});

test("noindex in the page or the header fails indexing", () => {
  assert.equal(by(score({ ...goodPage, robotsMeta: ["noindex, follow"] }, goodSite), "indexable").status, "fail");
  assert.equal(by(score(goodPage, { ...goodSite, xRobotsTag: "noindex" }), "indexable").status, "fail");
  assert.equal(by(score({ ...goodPage, robotsMeta: ["index, follow"] }, goodSite), "indexable").status, "pass");
});

test("warn cases get half points", () => {
  const r = score({ ...goodPage, title: "Home", h1Count: 3, viewport: "width=1024" }, { ...goodSite, httpRedirectsToHttps: false });
  for (const id of ["title", "h1", "viewport", "https"]) assert.equal(by(r, id).status, "warn", id);
  assert.equal(by(r, "https").points, 8);
  assert.equal(by(r, "title").points, 5);
});

test("title and description length boundaries", () => {
  assert.equal(by(score({ ...goodPage, title: "x".repeat(60) }, goodSite), "title").status, "pass");
  assert.equal(by(score({ ...goodPage, title: "x".repeat(61) }, goodSite), "title").status, "warn");
  assert.equal(by(score({ ...goodPage, metaDescription: "x".repeat(160) }, goodSite), "description").status, "pass");
  assert.equal(by(score({ ...goodPage, metaDescription: "x".repeat(49) }, goodSite), "description").status, "warn");
});

test("schema: local types pass, organization warns, others fail", () => {
  const graph = JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite" }, { "@type": ["Dentist", "MedicalBusiness"] }] });
  assert.deepEqual(schemaTypes([graph]).sort(), ["Dentist", "MedicalBusiness", "WebSite"]);
  assert.equal(by(score({ ...goodPage, jsonLd: [graph] }, goodSite), "schema").status, "pass");
  assert.equal(by(score({ ...goodPage, jsonLd: ['{"@type":"Organization"}'] }, goodSite), "schema").status, "warn");
  assert.equal(by(score({ ...goodPage, jsonLd: ['{"@type":"WebPage"}', "{not json"] }, goodSite), "schema").status, "fail");
  assert.equal(by(score({ ...goodPage, jsonLd: [], itemTypes: ["https://schema.org/HardwareStore"] }, goodSite), "schema").status, "pass");
});

test("robots.txt parsing", () => {
  assert.deepEqual(parseRobots("User-agent: *\nDisallow: /\n"), { blocksAll: true, sitemaps: [] });
  assert.deepEqual(parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nSitemap: https://x.com/sitemap.xml"),
                   { blocksAll: false, sitemaps: ["https://x.com/sitemap.xml"] });
  assert.equal(parseRobots("User-agent: Bingbot\nUser-agent: *\nDisallow: / # everything\n").blocksAll, true);
  assert.equal(parseRobots("User-agent: *\nDisallow:\n").blocksAll, false);
});

test("crawl check: blocked, missing, partial, unknown", () => {
  assert.equal(by(score(goodPage, { ...goodSite, robots: { found: true, blocksAll: true, sitemaps: [] } }), "crawl").status, "fail");
  assert.equal(by(score(goodPage, { ...goodSite, sitemap: { found: false, valid: false } }), "crawl").status, "warn");
  assert.equal(by(score(goodPage, { ...goodSite, robots: { found: false, blocksAll: false, sitemaps: [] } }), "crawl").status, "warn");
  const unknown = score(goodPage, { ...goodSite, robots: null, sitemap: null });
  assert.equal(by(unknown, "crawl").status, "unknown");
  assert.equal(unknown.score, 100); // unknown checks don't count against the score
});

test("image alt thresholds", () => {
  assert.equal(by(score({ ...goodPage, imgTotal: 8, imgMissingAlt: 2 }, goodSite), "alt").status, "warn");
  assert.equal(by(score({ ...goodPage, imgTotal: 8, imgMissingAlt: 3 }, goodSite), "alt").status, "fail");
  assert.equal(by(score({ ...goodPage, imgTotal: 0, imgMissingAlt: 0 }, goodSite), "alt").status, "pass");
});

test("page size thresholds and the JavaScript-site note", () => {
  assert.equal(by(score(goodPage, { ...goodSite, htmlBytes: 600 * 1024 }), "size").status, "warn");
  assert.equal(by(score(goodPage, { ...goodSite, htmlBytes: 1536 * 1024, truncated: true }), "size").status, "fail");
  assert.equal(score({ ...goodPage, textChars: 40, appRoot: true }, goodSite).notes.length, 1);
});
