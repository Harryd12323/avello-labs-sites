// Signed lead tickets, shared by the chat, check and alerts Workers.
//
// When the chat Worker produces a lead card, or the check Worker returns a result, it also returns a
// ticket signed with LEAD_SIGNING_KEY (a wrangler secret all three Workers share). The alerts Worker only
// sends a Telegram alert for a valid, unexpired, unused ticket. That way alerts can only come from a real
// chat or a real check, and the chat's lead details can't be changed after the fact.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(key, first part)). Uses only Web Crypto,
// so it runs in Workers and in Node's test runner.

export type ChatTicket = { v: 1; tool: "chat"; exp: number; n: string; h: string };
export type CheckTicket = { v: 1; tool: "site-check"; exp: number; n: string; site: string; score: number };
export type Ticket = ChatTicket | CheckTicket;

export const CHAT_TICKET_SECONDS = 60 * 60;
export const CHECK_TICKET_SECONDS = 30 * 60;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function nonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Hash of the chat lead fields the alert shows. Phone is deliberately left out: it never goes to Telegram. */
export async function leadHash(f: { name: string; email: string; business: string; website: string; goal: string }): Promise<string> {
  const canonical = JSON.stringify([f.name, f.email.toLowerCase(), f.business, f.website, f.goal].map((v) => (v ?? "").trim()));
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(canonical));
  return b64url(new Uint8Array(digest));
}

export async function signTicket(secret: string, payload: Omit<ChatTicket, "v" | "n" | "exp">, seconds: number, now?: number): Promise<string>;
export async function signTicket(secret: string, payload: Omit<CheckTicket, "v" | "n" | "exp">, seconds: number, now?: number): Promise<string>;
export async function signTicket(secret: string, payload: Record<string, unknown>, seconds: number, now = Date.now()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ v: 1, ...payload, exp: Math.floor(now / 1000) + seconds, n: nonce() })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** Returns the ticket if the signature is valid and it hasn't expired; otherwise null. */
export async function verifyTicket(secret: string, ticket: string, now = Date.now()): Promise<Ticket | null> {
  if (typeof ticket !== "string" || ticket.length > 1024) return null;
  const [body, sig, extra] = ticket.split(".");
  if (!body || !sig || extra !== undefined) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), unb64url(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  let p: Ticket;
  try {
    p = JSON.parse(new TextDecoder().decode(unb64url(body)));
  } catch {
    return null;
  }
  if (p?.v !== 1 || typeof p.exp !== "number" || typeof p.n !== "string" || p.exp * 1000 < now) return null;
  if (p.tool === "chat" && typeof p.h === "string") return p;
  if (p.tool === "site-check" && typeof p.site === "string" && typeof p.score === "number") return p;
  return null;
}
