// Turns what the Worker found on a site into scored checks with plain-English fixes. Pure functions,
// no Worker APIs, so the rules can be unit tested in Node. No AI is involved anywhere in the tool.

export type PageFacts = {
  title: string | null;
  metaDescription: string | null;
  robotsMeta: string[];           // content of <meta name="robots"> and <meta name="googlebot">
  viewport: string | null;
  h1Count: number;
  jsonLd: string[];               // raw JSON-LD blocks, capped in size
  itemTypes: string[];            // microdata itemtype URLs
  imgTotal: number;
  imgMissingAlt: number;          // images with no alt attribute at all (alt="" counts as decorative, which is fine)
  textChars: number;              // rough amount of readable text
  scriptCount: number;
  appRoot: boolean;               // an empty JavaScript-app container like <div id="root">
};

export type SiteFacts = {
  finalUrl: string;
  finalHttps: boolean;
  httpRedirectsToHttps: boolean | null; // null when it couldn't be checked
  xRobotsTag: string | null;
  htmlBytes: number;
  truncated: boolean;                   // page was bigger than the read cap
  robots: { found: boolean; blocksAll: boolean; sitemaps: string[] } | null;
  sitemap: { found: boolean; valid: boolean } | null;
};

export type Status = "pass" | "warn" | "fail" | "unknown";
export type CheckResult = { id: string; label: string; status: Status; points: number; max: number; detail: string; fix: string };
export type Report = { score: number; checks: CheckResult[]; notes: string[] };

const KB = 1024;

// LocalBusiness and its common schema.org subtypes. Anything ending in "Store" also counts.
const LOCAL_TYPES = new Set([
  "LocalBusiness", "AnimalShelter", "AutomotiveBusiness", "AutoRepair", "AutoDealer", "AutoBodyShop", "AutoWash", "ChildCare",
  "Dentist", "DryCleaningOrLaundry", "EmergencyService", "EmploymentAgency", "EntertainmentBusiness", "FinancialService",
  "AccountingService", "InsuranceAgency", "FoodEstablishment", "Restaurant", "Bakery", "BarOrPub", "Brewery", "CafeOrCoffeeShop",
  "FastFoodRestaurant", "IceCreamShop", "Winery", "HealthAndBeautyBusiness", "BeautySalon", "DaySpa", "HairSalon", "NailSalon",
  "TattooParlor", "HealthClub", "HomeAndConstructionBusiness", "Electrician", "GeneralContractor", "HVACBusiness", "HousePainter",
  "Locksmith", "MovingCompany", "Plumber", "RoofingContractor", "LegalService", "Attorney", "Notary", "LodgingBusiness", "Hotel",
  "Motel", "BedAndBreakfast", "MedicalBusiness", "MedicalClinic", "Physician", "Pharmacy", "Optician", "VeterinaryCare",
  "ProfessionalService", "RealEstateAgent", "RecyclingCenter", "SelfStorage", "SportsActivityLocation", "Store", "Florist",
  "TravelAgency", "TouristInformationCenter", "GolfCourse", "BowlingAlley", "ExerciseGym", "Library",
]);
const ORG_TYPES = new Set(["Organization", "Corporation", "OnlineBusiness", "OnlineStore", "NGO", "EducationalOrganization"]);

/** Every @type in the JSON-LD blocks, including inside @graph and nested objects. Bad JSON is skipped. */
export function schemaTypes(blocks: string[], itemTypes: string[] = []): string[] {
  const found = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const t = (v as Record<string, unknown>)["@type"];
    for (const name of Array.isArray(t) ? t : [t]) if (typeof name === "string") found.add(name.replace(/^.*[/#]/, ""));
    for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
  };
  for (const b of blocks) {
    try { walk(JSON.parse(b), 0); } catch { /* invalid JSON-LD is ignored */ }
  }
  for (const it of itemTypes) for (const u of it.split(/\s+/)) if (u) found.add(u.replace(/^.*[/#]/, ""));
  return [...found];
}

const isLocal = (t: string) => LOCAL_TYPES.has(t) || (t.endsWith("Store") && t !== "OnlineStore");

function check(id: string, label: string, max: number, status: Status, detail: string, fix = ""): CheckResult {
  const points = status === "pass" ? max : status === "warn" ? Math.round(max / 2) : 0;
  return { id, label, status, points, max, detail, fix: status === "pass" ? "" : fix };
}

export function score(page: PageFacts, site: SiteFacts): Report {
  const checks: CheckResult[] = [];
  const notes: string[] = [];

  // 1. HTTPS
  if (!site.finalHttps) {
    checks.push(check("https", "Secure connection (HTTPS)", 15, "fail", "Your page loads without HTTPS, so browsers mark it \"Not secure\".",
      "Turn on an SSL certificate (most hosts offer one free) and redirect every http:// address to https://."));
  } else if (site.httpRedirectsToHttps === false) {
    checks.push(check("https", "Secure connection (HTTPS)", 15, "warn", "Your site works over HTTPS, but the http:// version doesn't redirect to it.",
      "Add a permanent (301) redirect from http:// to https://, so visitors and Google always land on the secure version."));
  } else {
    checks.push(check("https", "Secure connection (HTTPS)", 15, "pass", "Your page loads securely over HTTPS."));
  }

  // 2. Indexable
  const noindex = [...page.robotsMeta, site.xRobotsTag ?? ""].some((v) => /\b(noindex|none)\b/i.test(v));
  checks.push(noindex
    ? check("indexable", "Allowed in Google", 15, "fail", "This page tells search engines not to index it (a \"noindex\" tag), so it can't show up in Google.",
        "Remove the noindex instruction from the page's robots meta tag or your server's X-Robots-Tag header, unless you really want the page hidden.")
    : check("indexable", "Allowed in Google", 15, "pass", "Nothing on this page tells search engines to stay away."));

  // 3. Title
  const title = (page.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) {
    checks.push(check("title", "Page title", 10, "fail", "This page has no title tag.",
      "Add a title that says what you do and where, for example \"Emergency Plumber in Collingswood, NJ | Smith Plumbing\"."));
  } else if (title.length < 10 || title.length > 60) {
    checks.push(check("title", "Page title", 10, "warn", `Your title is ${title.length} characters: "${clip(title, 70)}"`,
      title.length < 10 ? "Make the title more descriptive: what you do, where, and your business name, in about 30 to 60 characters."
                        : "Shorten the title to about 60 characters so Google doesn't cut it off, keeping the most important words first."));
  } else {
    checks.push(check("title", "Page title", 10, "pass", `Good length (${title.length} characters): "${clip(title, 70)}"`));
  }

  // 4. Meta description
  const desc = (page.metaDescription ?? "").replace(/\s+/g, " ").trim();
  if (!desc) {
    checks.push(check("description", "Meta description", 10, "fail", "This page has no meta description, so Google picks a snippet for you.",
      "Add a one or two sentence description (about 120 to 160 characters) that tells searchers what you offer and why to choose you."));
  } else if (desc.length < 50 || desc.length > 160) {
    checks.push(check("description", "Meta description", 10, "warn", `Your description is ${desc.length} characters.`,
      desc.length < 50 ? "Expand the description to about 120 to 160 characters so it gives searchers a real reason to click."
                       : "Trim the description to about 160 characters so it isn't cut off in search results."));
  } else {
    checks.push(check("description", "Meta description", 10, "pass", `Good length (${desc.length} characters).`));
  }

  // 5. Mobile viewport
  if (!page.viewport) {
    checks.push(check("viewport", "Mobile-friendly setup", 10, "fail", "This page has no mobile viewport tag, so phones may show a shrunken desktop page.",
      "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the page's head, and check the layout on a phone."));
  } else if (!/width\s*=\s*device-width/i.test(page.viewport)) {
    checks.push(check("viewport", "Mobile-friendly setup", 10, "warn", "There's a viewport tag, but it doesn't use the standard width=device-width setting.",
      "Use content=\"width=device-width, initial-scale=1\" so the page fits every screen."));
  } else {
    checks.push(check("viewport", "Mobile-friendly setup", 10, "pass", "The page is set up to fit phone screens."));
  }

  // 6. H1
  if (page.h1Count === 0) {
    checks.push(check("h1", "Main heading (H1)", 10, "fail", "This page has no main heading (H1).",
      "Give the page one clear H1 that says what the page is about, like \"Emergency Plumbing in Collingswood\"."));
  } else if (page.h1Count > 1) {
    checks.push(check("h1", "Main heading (H1)", 10, "warn", `This page has ${page.h1Count} main headings (H1s).`,
      "Keep one H1 for the page's main topic and make the others H2 or H3 subheadings."));
  } else {
    checks.push(check("h1", "Main heading (H1)", 10, "pass", "The page has exactly one main heading."));
  }

  // 7. Business schema
  const types = schemaTypes(page.jsonLd, page.itemTypes);
  const local = types.filter(isLocal);
  if (local.length) {
    checks.push(check("schema", "Business details for search engines", 10, "pass", `Structured data describes your business (${local.slice(0, 3).join(", ")}).`));
  } else if (types.some((t) => ORG_TYPES.has(t))) {
    checks.push(check("schema", "Business details for search engines", 10, "warn", "There's structured data for an organization, but not for a local business.",
      "Use the LocalBusiness type (or a specific one like Plumber or Dentist) with your name, address or service area, phone and hours."));
  } else {
    checks.push(check("schema", "Business details for search engines", 10, "fail",
      types.length ? `There's structured data (${types.slice(0, 3).join(", ")}), but nothing that describes your business.` : "No structured data (schema markup) describes your business.",
      "Add LocalBusiness schema markup with your business name, address or service area, phone, hours and website. It helps Google and AI tools get your details right."));
  }

  // 8. robots.txt and sitemap
  if (site.robots === null && site.sitemap === null) {
    checks.push(check("crawl", "robots.txt and sitemap", 10, "unknown", "We couldn't load your robots.txt or sitemap to check them.", ""));
  } else if (site.robots?.blocksAll) {
    checks.push(check("crawl", "robots.txt and sitemap", 10, "fail", "Your robots.txt tells all search engines to stay away from the whole site.",
      "Remove the \"Disallow: /\" rule for all user agents in robots.txt, unless the site isn't meant to be public yet."));
  } else {
    const robotsOk = !!site.robots?.found, mapOk = !!site.sitemap?.valid;
    if (robotsOk && mapOk) {
      checks.push(check("crawl", "robots.txt and sitemap", 10, "pass", "Found a robots.txt and a valid sitemap."));
    } else if (!robotsOk && !mapOk) {
      checks.push(check("crawl", "robots.txt and sitemap", 10, "fail", "Couldn't find a robots.txt or a sitemap.",
        "Add a sitemap.xml listing your pages and a robots.txt that points to it, then submit the sitemap in Google Search Console."));
    } else if (!mapOk) {
      checks.push(check("crawl", "robots.txt and sitemap", 10, "warn",
        site.sitemap?.found ? "Found a sitemap, but it doesn't look like valid sitemap XML." : "Found a robots.txt, but no sitemap.",
        "Add a sitemap.xml listing your pages, mention it in robots.txt, and submit it in Google Search Console."));
    } else {
      checks.push(check("crawl", "robots.txt and sitemap", 10, "warn", "Found a sitemap, but no robots.txt.",
        "Add a simple robots.txt that allows crawling and points to your sitemap."));
    }
  }

  // 9. Image alt text
  if (page.imgTotal === 0) {
    checks.push(check("alt", "Image descriptions (alt text)", 5, "pass", "No images on this page need descriptions."));
  } else {
    const share = page.imgMissingAlt / page.imgTotal;
    const detail = page.imgMissingAlt === 0 ? `All ${page.imgTotal} images have alt text.` : `${page.imgMissingAlt} of ${page.imgTotal} images have no alt text.`;
    const fix = "Add short alt text describing each meaningful image (for example \"Technician repairing a furnace\"). It helps screen reader users and image search.";
    checks.push(check("alt", "Image descriptions (alt text)", 5, share === 0 ? "pass" : share <= 0.25 ? "warn" : "fail", detail, fix));
  }

  // 10. Page size
  const kb = Math.round(site.htmlBytes / KB);
  if (site.truncated) {
    checks.push(check("size", "Page size (HTML)", 5, "fail", "The page's HTML is over 1.5 MB, which is very heavy.",
      "Look for huge inline code or data in the page and move it into separate files, or ask your developer to trim it."));
  } else if (site.htmlBytes > 500 * KB) {
    checks.push(check("size", "Page size (HTML)", 5, "warn", `The page's HTML is ${kb} KB, which is on the heavy side.`,
      "Aim for HTML under about 500 KB. Inline scripts, styles and embedded data are the usual culprits."));
  } else {
    checks.push(check("size", "Page size (HTML)", 5, "pass", `The page's HTML is a lean ${Math.max(kb, 1)} KB.`));
  }

  if (page.textChars < 300 && (page.appRoot || page.scriptCount >= 5)) {
    notes.push("This page looks like it's built with JavaScript, so some content may only appear after it runs. This check reads the HTML your server sends, which is also what many search engines and AI tools see first.");
  }

  const counted = checks.filter((c) => c.status !== "unknown");
  const max = counted.reduce((n, c) => n + c.max, 0);
  const got = counted.reduce((n, c) => n + c.points, 0);
  return { score: max ? Math.round((got / max) * 100) : 0, checks, notes };
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Reads robots.txt: does the "*" group disallow everything, and which sitemaps does it list? */
export function parseRobots(text: string): { blocksAll: boolean; sitemaps: string[] } {
  const sitemaps: string[] = [];
  let blocksAll = false, inStar = false, lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "sitemap") { if (value) sitemaps.push(value); continue; }
    if (key === "user-agent") {
      inStar = lastWasAgent ? inStar || value === "*" : value === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inStar && key === "disallow" && value === "/") blocksAll = true;
    if (inStar && key === "allow" && value === "/") blocksAll = false;
  }
  return { blocksAll, sitemaps };
}
