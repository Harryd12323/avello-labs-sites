// Outgoing messages: email through Resend and alerts to Harris on Telegram.
import type { Env } from "./env";

/** Sends one email through Resend. idempotencyKey makes a retried send count once (Resend remembers it for 24 hours). */
export async function sendEmail(env: Env, message: Record<string, unknown>, idempotencyKey?: string): Promise<boolean> {
  const base = env.RESEND_API_BASE || "https://api.resend.com";
  try {
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
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

/** A plain-text Telegram message to Harris. Skipped (false) where Telegram isn't set up, as in the test Worker. */
export async function sendTelegram(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
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
