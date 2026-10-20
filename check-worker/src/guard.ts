// URL safety rules for the website check. Pure functions with no Worker APIs, so they can be unit tested
// in Node. The Worker runs on Cloudflare's network, so there's no private network for it to reach; these
// rules are defense in depth, and they also keep the tool to what it's for: checking public websites.

export type GuardResult = { ok: true; url: URL } | { ok: false; reason: string };

const MAX_URL_LENGTH = 2048;
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa", ".test", ".invalid", ".example", ".onion"];
// Our own Workers, so the tool can't be pointed at itself.
const OWN_HOSTS = [".avellolabs.workers.dev", "avellolabs.workers.dev"];

const friendly = {
  scheme: "Please enter a website address starting with http:// or https://.",
  format: "That doesn't look like a website address. Try something like yourbusiness.com.",
  ip: "Please enter your website's domain name, like yourbusiness.com, rather than an IP address.",
  private: "That address isn't a public website, so it can't be checked.",
  port: "Please enter the address without a port number.",
  login: "Please remove the username or password from the address.",
  long: "That address is too long to check.",
};

/** Turns what a visitor typed into a URL, adding https:// when they left it off, then applies the rules. */
export function normalizeAndGuard(input: string): GuardResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: friendly.format };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: friendly.long };
  if (/[\s<>"`\\]/.test(raw)) return { ok: false, reason: friendly.format };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  // "example.com:8080" parses as a scheme of "example.com", so only treat it as a scheme when it's followed by //.
  const withScheme = hasScheme && /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : hasScheme && !/^[\w.-]+:\d+/.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: friendly.format };
  }
  return guardUrl(url);
}

/** Applies the rules to an already-parsed URL. Used for the first URL and again for every redirect. */
export function guardUrl(url: URL): GuardResult {
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: friendly.scheme };
  if (url.href.length > MAX_URL_LENGTH) return { ok: false, reason: friendly.long };
  if (url.username || url.password) return { ok: false, reason: friendly.login };
  if (url.port !== "") return { ok: false, reason: friendly.port };

  // WHATWG URL parsing already turns tricks like 0x7f000001, 2130706433 or 0177.0.0.1 into dotted form.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: friendly.format };
  if (host.startsWith("[") || isIPv4(host)) {
    // Any IP literal is refused; a public one would work but isn't what the tool is for.
    return { ok: false, reason: isPrivateAddress(host.replace(/^\[|\]$/g, "")) ? friendly.private : friendly.ip };
  }
  if (!host.includes(".")) return { ok: false, reason: friendly.private };
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: friendly.private };
  if (OWN_HOSTS.some((s) => host === s.replace(/^\./, "") || host.endsWith(s))) return { ok: false, reason: friendly.private };
  if (!/^[a-z0-9.-]+$/.test(host) || host.split(".").some((l) => !l || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) {
    return { ok: false, reason: friendly.format };
  }
  if (!/^(xn--[a-z0-9-]+|[a-z]{2,})$/.test(host.split(".").pop()!)) return { ok: false, reason: friendly.format };

  url.hash = "";
  return { ok: true, url };
}

export function isIPv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function v4ToInt(s: string): number {
  return s.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True for loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  const v6 = expandIPv6(ip);
  if (!v6) return true; // unparseable: treat as unsafe
  const [a, b] = v6;
  if (v6.every((x) => x === 0)) return true; // ::
  if (v6.slice(0, 7).every((x) => x === 0) && v6[7] === 1) return true; // ::1
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96): check the embedded IPv4.
  const mapped = v6.slice(0, 5).every((x) => x === 0) && (v6[5] === 0xffff || v6[5] === 0);
  const nat64 = a === 0x64 && b === 0xff9b && v6.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) {
    const v4 = `${v6[6] >> 8}.${v6[6] & 255}.${v6[7] >> 8}.${v6[7] & 255}`;
    return isPrivateAddress(v4);
  }
  return false;
}

function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (!isIPv4(v4[1])) return null;
    const n = v4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}
