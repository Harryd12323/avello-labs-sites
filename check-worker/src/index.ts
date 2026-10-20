import { Limiter } from "./limiter";
import { normalizeAndGuard } from "./guard";
import { TargetFetcher, CheckError } from "./fetcher";
import { analyzeHtml } from "./analyze";
import { score, parseRobots, type SiteFacts } from "./scoring";
import { parseRobots as parseRobotsGroups, evaluate } from "./robots";
import { BOTS, LAST_REVIEWED } from "./bots";
import type { Limits } from "./limiter";
import { signTicket, CHECK_TICKET_SECONDS, NEWSLETTER_TICKET_SECONDS } from "../../workers-shared/ticket";

export { Limiter };

// Avello Labs free tools backend. Routes:
//   /check              instant website check: fetches the page, its http:// redirect, robots.txt and sitemap
//   /preview            search preview: fetches one page and returns its title and meta description
//   /crawlers           AI crawler check: fetches robots.txt and evaluates known AI and search bots
//   /ticket/newsletter  issues a signed newsletter ticket for the alerts Worker
// Everything is rule-based: no AI, no logging of visitor URLs, and nothing stored except rate-limit counters.

export interface Env {
  LIMITER: DurableObjectNamespace<Limiter>;
  ALLOWED_ORIGINS: string;
  PER_IP_PER_HOUR: string;
  PER_TARGET_PER_HOUR: string;
  DAILY_CAP: string;
  PREVIEW_PER_IP_PER_HOUR: string;
  PREVIEW_PER_TARGET_PER_HOUR: string;
  PREVIEW_DAILY_CAP: string;
  CRAWLERS_PER_IP_PER_HOUR: string;
  CRAWLERS_PER_TARGET_PER_HOUR: string;
  CRAWLERS_DAILY_CAP: string;
  NEWSLETTER_TICKETS_PER_IP_PER_HOUR: string;
  NEWSLETTER_TICKETS_DAILY_CAP: string;
  TEST?: string;
  LEAD_SIGNING_KEY?: string;
}

const PAGE_CAP = 1536 * 1024;
const SMALL_CAP = 100 * 1024;
const TOTAL_BUDGET_MS = 15_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    if (!env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin)) return new Response("Forbidden", { status: 403 });
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    // Local testing only: score a fixture page without fetching anything. Never enabled in production.
    if (url.pathname === "/__test/analyze" && env.TEST === "1") {
      const body = (await request.json()) as { html: string; site?: Partial<SiteFacts> };
      const page = await analyzeHtml(new TextEncoder().encode(body.html));
      return json({ page, report: score(page, { ...defaultSite(), ...body.site }) });
    }

    const tool = TOOLS[url.pathname];
    if (!tool) return json({ error: "not_found" }, 404);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const limiter = env.LIMITER.get(env.LIMITER.idFromName("global"));
    const limited = (reason: "daily_cap" | "ip_hourly" | "target_hourly", retry: number) =>
      json({ error: "rate_limited", message: tool.messages[reason] }, 429, { "Retry-After": String(retry) });

    // Newsletter tickets: no URL involved, just a per-visitor and daily limit.
    if (tool.name === "newsletter") {
      const v = await limiter.consume("newsletter", ip, "newsletter", tool.limits(env));
      if (!v.ok) return limited(v.reason, v.retryAfterSeconds);
      if (!env.LEAD_SIGNING_KEY) return json({ error: "not_configured" }, 503);
      const ticket = await signTicket(env.LEAD_SIGNING_KEY, { tool: "newsletter", iat: Math.floor(Date.now() / 1000) }, NEWSLETTER_TICKET_SECONDS);
      return json({ ticket });
    }

    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "bad_request", message: "That address is too long to check." }, 400);
    let input: string;
    try {
      input = String((JSON.parse(raw) as { url?: unknown }).url ?? "");
    } catch {
      return json({ error: "bad_request", message: "Please enter a website address." }, 400);
    }
    const guarded = normalizeAndGuard(input);
    if (!guarded.ok) return json({ error: "bad_url", message: guarded.reason }, 400);
    const target = guarded.url;

    const verdict = await limiter.consume(tool.name, ip, target.hostname, tool.limits(env));
    if (!verdict.ok) return limited(verdict.reason, verdict.retryAfterSeconds);

    try {
      if (tool.name === "preview") return json(await runPreview(target));
      if (tool.name === "crawlers") return json(await runCrawlers(target));
      const result = await runCheck(target);
      // A signed ticket lets the visitor's "full report" request trigger one Telegram alert to Harris.
      const ticket = env.LEAD_SIGNING_KEY
        ? await signTicket(env.LEAD_SIGNING_KEY, { tool: "site-check", site: result.finalUrl.slice(0, 200), score: result.score }, CHECK_TICKET_SECONDS)
        : undefined;
      return json({ ...result, ticket });
    } catch (e) {
      if (e instanceof CheckError) return json({ error: "check_failed", message: e.message }, 422);
      // Log only that something failed, never the URL being checked.
      console.error("tool_error", tool.name, e instanceof Error ? e.constructor.name : "unknown");
      return json({ error: "check_failed", message: "Something went wrong while checking that site. Please try again." }, 502);
    }
  },
};

type ToolName = "check" | "preview" | "crawlers" | "newsletter";
const busy = {
  ip_hourly: "You've used this tool quite a few times in the last hour. Please try again a little later.",
  target_hourly: "That site has been checked a lot in the last hour. Please try again a little later.",
};
const TOOLS: Record<string, { name: ToolName; limits: (env: Env) => Limits; messages: Record<"daily_cap" | "ip_hourly" | "target_hourly", string> }> = {
  "/check": {
    name: "check",
    limits: (env) => ({ perIpPerHour: Number(env.PER_IP_PER_HOUR), perTargetPerHour: Number(env.PER_TARGET_PER_HOUR), dailyCap: Number(env.DAILY_CAP) }),
    messages: { ...busy, ip_hourly: "You've run quite a few checks in the last hour. Please try again a little later.",
      daily_cap: "The free check has reached its limit for today. Please try again tomorrow, or email harris@avellolabs.com for a hand-checked review." },
  },
  "/preview": {
    name: "preview",
    limits: (env) => ({ perIpPerHour: Number(env.PREVIEW_PER_IP_PER_HOUR), perTargetPerHour: Number(env.PREVIEW_PER_TARGET_PER_HOUR), dailyCap: Number(env.PREVIEW_DAILY_CAP) }),
    messages: { ...busy, daily_cap: "Loading pages has reached its limit for today. You can still type a title and description in by hand." },
  },
  "/crawlers": {
    name: "crawlers",
    limits: (env) => ({ perIpPerHour: Number(env.CRAWLERS_PER_IP_PER_HOUR), perTargetPerHour: Number(env.CRAWLERS_PER_TARGET_PER_HOUR), dailyCap: Number(env.CRAWLERS_DAILY_CAP) }),
    messages: { ...busy, daily_cap: "The AI crawler check has reached its limit for today. Please try again tomorrow." },
  },
  "/ticket/newsletter": {
    name: "newsletter",
    limits: (env) => ({ perIpPerHour: Number(env.NEWSLETTER_TICKETS_PER_IP_PER_HOUR), perTargetPerHour: Number.MAX_SAFE_INTEGER, dailyCap: Number(env.NEWSLETTER_TICKETS_DAILY_CAP) }),
    messages: { ...busy, daily_cap: "Signups are busy right now. Please try again later." },
  },
};

/** Search preview from a live page: just its title, meta description and final address. */
async function runPreview(target: URL) {
  const fetcher = new TargetFetcher(Date.now() + TOTAL_BUDGET_MS, 6);
  const page = await fetcher.get(target, PAGE_CAP);
  if (!page) throw new CheckError("We couldn't load that page. It may be down, very slow, or blocking automated checks.");
  if (page.status >= 400) throw new CheckError(`That page returned an error (status ${page.status}).`);
  const type = page.headers.get("Content-Type") ?? "";
  if (type && !/html|xml/i.test(type)) throw new CheckError("That address doesn't look like a web page.");
  const facts = await analyzeHtml(page.bytes);
  return { url: target.href, finalUrl: page.finalUrl.href, title: facts.title ?? "", description: facts.metaDescription ?? "" };
}

/** AI crawler check: reads the site's robots.txt and evaluates each known bot for the requested path. */
async function runCrawlers(target: URL) {
  const fetcher = new TargetFetcher(Date.now() + TOTAL_BUDGET_MS, 6);
  const robotsUrl = new URL("/robots.txt", target.origin);
  const path = (target.pathname || "/") + target.search;
  const res = await fetcher.get(robotsUrl, SMALL_CAP, "text/plain,*/*");

  // RFC 9309: a missing robots.txt (4xx) means everything is allowed; an unreachable one (5xx or no
  // response) means crawlers should assume everything is blocked until it comes back.
  let status: "found" | "missing" | "unreachable";
  let groups = parseRobotsGroups("");
  let text = "";
  if (!res || res.status >= 500) {
    status = "unreachable";
  } else if (res.status >= 400) {
    status = "missing";
  } else {
    text = new TextDecoder().decode(res.bytes);
    // Some sites answer every unknown address with their home page; that isn't a robots.txt.
    status = /^\s*</.test(text) ? "missing" : "found";
    if (status === "found") groups = parseRobotsGroups(text);
  }

  const bots = BOTS.map((b) => {
    if (status === "unreachable") return { ...b, allowed: false, rule: "robots.txt couldn't be loaded", group: null };
    const v = evaluate(groups, b.token, path);
    return { ...b, ...v };
  });
  const count = (cat: string) => ({ total: bots.filter((b) => b.category === cat).length, allowed: bots.filter((b) => b.category === cat && b.allowed).length });
  return {
    url: target.href,
    robotsUrl: robotsUrl.href,
    finalRobotsUrl: res ? res.finalUrl.href : robotsUrl.href,
    httpStatus: res ? res.status : null,
    status,
    path,
    reviewed: LAST_REVIEWED,
    bots,
    summary: { aiSearch: count("ai-search"), user: count("user"), training: count("training"), token: count("token"), search: count("search") },
  };
}

async function runCheck(target: URL) {
  const fetcher = new TargetFetcher(Date.now() + TOTAL_BUDGET_MS);

  const page = await fetcher.get(target, PAGE_CAP);
  if (!page) throw new CheckError("We couldn't load that page. It may be down, very slow, or blocking automated checks.");
  if (page.status >= 400) throw new CheckError(`That page returned an error (status ${page.status}), so it couldn't be checked.`);
  const type = page.headers.get("Content-Type") ?? "";
  if (type && !/html|xml/i.test(type)) throw new CheckError("That address doesn't look like a web page.");

  const facts = await analyzeHtml(page.bytes);
  const finalUrl = page.finalUrl;
  const finalHttps = finalUrl.protocol === "https:";
  const origin = new URL(finalUrl.origin);

  const [httpRedirectsToHttps, robots] = await Promise.all([
    finalHttps ? fetcher.redirectsToHttps(origin) : Promise.resolve(false),
    readRobots(fetcher, origin),
  ]);
  const sitemap = await readSitemap(fetcher, origin, robots?.sitemaps ?? []);

  const site: SiteFacts = {
    finalUrl: finalUrl.href,
    finalHttps,
    httpRedirectsToHttps,
    xRobotsTag: page.headers.get("X-Robots-Tag"),
    htmlBytes: page.bytes.byteLength,
    truncated: page.truncated,
    robots,
    sitemap,
  };
  const report = score(facts, site);
  return { url: target.href, finalUrl: finalUrl.href, ...report };
}

async function readRobots(fetcher: TargetFetcher, origin: URL): Promise<SiteFacts["robots"]> {
  try {
    const res = await fetcher.get(new URL("/robots.txt", origin), SMALL_CAP, "text/plain,*/*");
    if (!res) return null;
    const text = new TextDecoder().decode(res.bytes);
    // Some sites answer every missing file with their home page; that isn't a robots.txt.
    if (res.status !== 200 || /^\s*</.test(text)) return { found: false, blocksAll: false, sitemaps: [] };
    return { found: true, ...parseRobots(text) };
  } catch (e) {
    if (e instanceof CheckError) return null;
    throw e;
  }
}

async function readSitemap(fetcher: TargetFetcher, origin: URL, listed: string[]): Promise<SiteFacts["sitemap"]> {
  let candidate: URL;
  try {
    candidate = listed.length ? new URL(listed[0], origin) : new URL("/sitemap.xml", origin);
  } catch {
    candidate = new URL("/sitemap.xml", origin);
  }
  try {
    const res = await fetcher.get(candidate, SMALL_CAP, "application/xml,text/xml,*/*");
    if (!res) return null;
    if (res.status !== 200) return { found: false, valid: false };
    if (/\.gz$/i.test(candidate.pathname)) return { found: true, valid: true };
    const text = new TextDecoder().decode(res.bytes);
    return { found: true, valid: /<(urlset|sitemapindex)\b/i.test(text) };
  } catch (e) {
    if (e instanceof CheckError) return null;
    throw e;
  }
}

function defaultSite(): SiteFacts {
  return {
    finalUrl: "https://fixture.example/", finalHttps: true, httpRedirectsToHttps: true, xRobotsTag: null, htmlBytes: 1000,
    truncated: false, robots: { found: true, blocksAll: false, sitemaps: [] }, sitemap: { found: true, valid: true },
  };
}
