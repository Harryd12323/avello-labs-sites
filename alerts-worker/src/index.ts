import { AlertGate } from "./gate";
import { formatAlert, formatNewsletter, quotaNote, clean, PAUSED_NOTICE, NEWSLETTER_PAUSED_NOTICE, type AlertInput } from "./message";
import type { Limits } from "./gate";
import { verifyTicket, leadHash } from "../../workers-shared/ticket";
import { parseAnswers, pickGuide, visitorEmail, ownerEmail, quizAlert, QUIZ_PAUSED_NOTICE } from "./quiz";

export { AlertGate };

// Avello Labs lead alerts. After a visitor sends a lead (by email, through Web3Forms), their browser also
// posts it here, and this Worker sends Harris a short Telegram message. It only does that for a valid,
// unused signed ticket from the chat or check Worker, within the rate limits. The bot token and chat ID
// are wrangler secrets; the browser never sees them. Nothing is logged except error types.
// It also runs the quiz on /tools/ (POST /quiz): after a Turnstile check and the rate limits, it emails the
// visitor the guide that fits their answers and emails Harris their answers, both through Resend.

export interface Env {
  GATE: DurableObjectNamespace<AlertGate>;
  ALLOWED_ORIGINS: string;
  PER_IP_PER_HOUR: string;
  PER_HOUR: string;
  PER_DAY: string;
  NEWSLETTER_PER_IP_PER_HOUR: string;
  NEWSLETTER_PER_DAY: string;
  LEAD_SIGNING_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_API_BASE?: string; // local testing only: points at a fake Telegram
  SITE_URL: string;
  QUIZ_FROM: string;
  QUIZ_TO: string;
  QUIZ_PER_IP_PER_HOUR: string;
  QUIZ_PER_DAY: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  RESEND_API_BASE?: string; // local testing only: points at a fake Resend
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const HOUR = 3600_000;
// Newsletter forms submitted sooner than this after the page asked for a ticket are treated as bots.
const MIN_FORM_SECONDS = 3;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    if (!env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).includes(origin)) return new Response("Forbidden", { status: 403 });
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const path = new URL(request.url).pathname;
    if (path !== "/lead" && path !== "/quiz") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (path === "/quiz") return quiz(request, env, json);
    if (!env.LEAD_SIGNING_KEY || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ error: "not_configured" }, 503);

    const raw = await request.text();
    if (raw.length > 8192) return json({ error: "too_large" }, 413);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "bad_request" }, 400);
    }

    const ticket = await verifyTicket(env.LEAD_SIGNING_KEY, String(body.ticket ?? ""));
    if (!ticket) return json({ error: "bad_ticket" }, 403);

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const gate = env.GATE.get(env.GATE.idFromName("global"));
    const emailSent = body.emailSent === true;

    if (ticket.tool === "newsletter") {
      const email = typeof body.email === "string" && body.email.length <= 120 ? body.email.trim() : "";
      const name = typeof body.name === "string" && body.name.length <= 80 ? body.name : "";
      const page = typeof body.page === "string" && body.page.length <= 120 && body.page.startsWith("/") ? body.page : "";
      if (!EMAIL_RE.test(email) || body.consent !== true) return json({ error: "bad_request" }, 400);
      if (Date.now() - ticket.iat * 1000 < MIN_FORM_SECONDS * 1000) return json({ ok: false, reason: "too_fast" }, 429);
      const limits: Limits = { perIpPerHour: Number(env.NEWSLETTER_PER_IP_PER_HOUR), perHour: Number(env.NEWSLETTER_PER_DAY),
        perDay: Number(env.NEWSLETTER_PER_DAY), dedupeMs: 24 * HOUR, pauseFor: "day" };
      const v = await gate.consume("newsletter", ticket.n, ticket.exp, ip, email.toLowerCase(), emailSent, limits);
      if (!v.ok) {
        if (v.notifyPause) await sendTelegram(env, NEWSLETTER_PAUSED_NOTICE);
        return json({ ok: false, reason: v.reason }, v.reason === "used" ? 409 : 429);
      }
      const sent = await sendTelegram(env, formatNewsletter({ name, email, page, emailSent }) + quotaNote(v.monthCount));
      return json({ ok: sent }, sent ? 200 : 502);
    }

    const str = (k: string, max: number) => {
      const v = body[k];
      return typeof v === "string" && v.length <= max ? v : null;
    };
    const name = str("name", 80), email = str("email", 120), business = str("business", 120) ?? "";
    if (!name?.trim() || !email || !EMAIL_RE.test(email.trim())) return json({ error: "bad_request" }, 400);

    let alert: AlertInput;
    if (ticket.tool === "chat") {
      const website = str("website", 200) ?? "", goal = str("goal", 500) ?? "";
      // The ticket covers these exact details, so they can't be changed after the chat produced them.
      if ((await leadHash({ name, email, business, website, goal })) !== ticket.h) return json({ error: "bad_ticket" }, 403);
      alert = { tool: "chat", name, email, business, website, wants: goal, emailSent };
    } else {
      // The site and score come from the ticket, not the browser.
      const note = str("note", 1000) ?? "";
      alert = {
        tool: "site-check", name, email, business, website: `${clean(ticket.site, 180)} · Score ${ticket.score}/100`,
        wants: note.trim() ? `Full SEO + AEO report. Note: ${note}` : "Full SEO + AEO report", emailSent,
      };
    }

    const verdict = await gate.consume("lead", ticket.n, ticket.exp, ip, `${ticket.tool}|${email.trim().toLowerCase()}`, emailSent, {
      perIpPerHour: Number(env.PER_IP_PER_HOUR), perHour: Number(env.PER_HOUR), perDay: Number(env.PER_DAY), dedupeMs: HOUR, pauseFor: "hour",
    });
    if (!verdict.ok) {
      if (verdict.notifyPause) await sendTelegram(env, PAUSED_NOTICE);
      return json({ ok: false, reason: verdict.reason }, verdict.reason === "used" ? 409 : 429);
    }

    const sent = await sendTelegram(env, formatAlert(alert) + quotaNote(verdict.monthCount));
    return json({ ok: sent }, sent ? 200 : 502);
  },
};

async function quiz(request: Request, env: Env, json: (body: unknown, status?: number) => Response): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ error: "not_configured" }, 503);
  const raw = await request.text();
  if (raw.length > 4096) return json({ error: "too_large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const answers = parseAnswers(body.answers);
  const email = typeof body.email === "string" && body.email.length <= 120 ? body.email.trim() : "";
  const name = typeof body.name === "string" && body.name.length <= 80 ? body.name : "";
  const token = typeof body.turnstile === "string" && body.turnstile.length <= 2048 ? body.turnstile : "";
  const newsletter = body.newsletter === true;
  if (!answers || !EMAIL_RE.test(email) || !token) return json({ error: "bad_request" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await turnstileOk(env, token, ip))) return json({ ok: false, reason: "turnstile" }, 403);

  // Each address gets one guide a day, and each visitor and the whole quiz have caps, so bots can't use the
  // quiz to flood someone's inbox or wear down the sending domain's reputation.
  const gate = env.GATE.get(env.GATE.idFromName("global"));
  const v = await gate.consume("quiz", crypto.randomUUID(), Math.floor(Date.now() / 1000) + 600, ip, email.toLowerCase(), false, {
    perIpPerHour: Number(env.QUIZ_PER_IP_PER_HOUR), perHour: Number(env.QUIZ_PER_DAY), perDay: Number(env.QUIZ_PER_DAY),
    dedupeMs: 24 * HOUR, pauseFor: "day",
  });
  if (!v.ok) {
    if (v.notifyPause) await sendTelegram(env, QUIZ_PAUSED_NOTICE);
    return json({ ok: false, reason: v.reason }, 429);
  }

  const guide = pickGuide(answers);
  const sent = await sendEmail(env, { from: env.QUIZ_FROM, to: [email], reply_to: env.QUIZ_TO, ...visitorEmail(env.SITE_URL, guide) });
  await sendEmail(env, { from: env.QUIZ_FROM, to: [env.QUIZ_TO], reply_to: email, ...ownerEmail({ answers, guide, name, email, newsletter }) });
  await sendTelegram(env, quizAlert({ guide, email, newsletter, sent }));
  return json({ ok: sent, guide }, sent ? 200 : 502);
}

async function turnstileOk(env: Env, token: string, ip: string): Promise<boolean> {
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET!, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean; action?: string; metadata?: { result_with_testing_key?: boolean } };
    // Cloudflare's test secret (local testing only) answers without an action.
    return data.success === true && (data.action === "quiz" || data.metadata?.result_with_testing_key === true);
  } catch (e) {
    console.error("turnstile_error", e instanceof Error ? e.constructor.name : "unknown");
    return false;
  }
}

async function sendEmail(env: Env, message: Record<string, unknown>): Promise<boolean> {
  const base = env.RESEND_API_BASE || "https://api.resend.com";
  try {
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("resend_error", res.status);
    return res.ok;
  } catch (e) {
    console.error("resend_error", e instanceof Error ? e.constructor.name : "unknown");
    return false;
  }
}

async function sendTelegram(env: Env, text: string): Promise<boolean> {
  const base = env.TELEGRAM_API_BASE || "https://api.telegram.org";
  try {
    const res = await fetch(`${base}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("telegram_error", res.status);
    return res.ok;
  } catch (e) {
    console.error("telegram_error", e instanceof Error ? e.constructor.name : "unknown");
    return false;
  }
}
