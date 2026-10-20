import { guardUrl, isPrivateAddress } from "./guard";

// Fetches from the visitor's site with every safety rule applied: each URL (including every redirect hop)
// passes the guard, each new hostname is looked up through Cloudflare's DNS and refused if it points at a
// private address, redirects are followed by hand (at most 5), and every fetch has a timeout and a size cap.

export const USER_AGENT = "AvelloLabsSiteCheck/1.0 (+https://avellolabs.com/check/)";
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

export class CheckError extends Error {}

export type Fetched = { finalUrl: URL; status: number; headers: Headers; bytes: Uint8Array; truncated: boolean };

export class TargetFetcher {
  private dnsOk = new Map<string, true>();
  private requests = 0;

  constructor(private deadline: number, private maxRequests = 12) {}

  get requestCount(): number {
    return this.requests;
  }

  timeLeft(): number {
    return this.deadline - Date.now();
  }

  /** GETs a URL, following up to 5 redirects by hand. Returns null on network failure or timeout. */
  async get(start: URL, cap: number, accept = "text/html,application/xhtml+xml"): Promise<Fetched | null> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const g = guardUrl(new URL(url.href));
      if (!g.ok) throw new CheckError(hop === 0 ? g.reason : "That page redirects to an address that can't be checked.");
      try {
        await this.checkDns(url.hostname);
      } catch (e) {
        if (hop > 0 && e instanceof CheckError) throw new CheckError("That page redirects to an address that can't be checked.");
        throw e;
      }
      if (this.requests >= this.maxRequests || this.timeLeft() < 500) return null;
      this.requests++;
      let res: Response;
      try {
        res = await fetch(url.href, {
          redirect: "manual",
          headers: { "User-Agent": USER_AGENT, Accept: accept },
          signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, this.timeLeft())),
        });
      } catch {
        return null;
      }
      const location = res.headers.get("Location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        try { url = new URL(location, url); } catch { return null; }
        continue;
      }
      const { bytes, truncated } = await readCapped(res, cap);
      return { finalUrl: url, status: res.status, headers: res.headers, bytes, truncated };
    }
    return null; // too many redirects
  }

  /** Checks only whether http:// redirects to https:// (doesn't follow the redirect). */
  async redirectsToHttps(origin: URL): Promise<boolean | null> {
    const httpUrl = new URL(origin.href);
    httpUrl.protocol = "http:";
    httpUrl.pathname = "/";
    httpUrl.search = "";
    if (this.requests >= this.maxRequests || this.timeLeft() < 500) return null;
    await this.checkDns(httpUrl.hostname);
    this.requests++;
    try {
      const res = await fetch(httpUrl.href, {
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, this.timeLeft())),
      });
      await res.body?.cancel();
      const loc = res.headers.get("Location");
      return res.status >= 300 && res.status < 400 && !!loc && new URL(loc, httpUrl).protocol === "https:";
    } catch {
      return null;
    }
  }

  /** Looks the hostname up through Cloudflare's DNS-over-HTTPS and refuses private answers. */
  async checkDns(host: string): Promise<void> {
    if (this.dnsOk.has(host)) return;
    const answers: string[] = [];
    let anyResponse = false;
    for (const type of ["A", "AAAA"]) {
      try {
        const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
          headers: { Accept: "application/dns-json" },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;
        anyResponse = true;
        const data = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
        for (const a of data.Answer ?? []) if (a.type === 1 || a.type === 28) answers.push(a.data);
      } catch { /* try the next record type */ }
    }
    if (!anyResponse) throw new CheckError("We couldn't look up that website right now. Please try again in a minute.");
    if (!answers.length) throw new CheckError("We couldn't find that website. Please check the address and try again.");
    if (answers.some(isPrivateAddress)) throw new CheckError("That address isn't a public website, so it can't be checked.");
    this.dnsOk.set(host, true);
  }
}

/** Reads a response body up to `cap` bytes, then stops reading. */
export async function readCapped(res: Response, cap: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0, truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > cap) {
      chunks.push(value.subarray(0, cap - total));
      total = cap;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return { bytes: out, truncated };
}
