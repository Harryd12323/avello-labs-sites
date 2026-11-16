// Bindings, variables and secrets of the avello-alerts Worker (see wrangler.jsonc).
import type { AlertGate } from "./gate";
import type { TipsList } from "./tipslist";

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
  // The 5 tip emails for quiz signups who confirm (see tips.ts and tipslist.ts).
  TIPS: DurableObjectNamespace<TipsList>;
  TIPS_SIGNING_KEY?: string;       // signs the confirm, unsubscribe and stop links
  RESEND_WEBHOOK_SECRET?: string;  // verifies Resend's "email received" webhook (replies to tip emails)
  TIPS_BACKFILL?: string;          // one-off: people who ticked the box before launch, "email | name | guide" per line
  TIPS_DAY_SECONDS: string;        // length of a "day" in the schedule: 86400, or 60 for the test run
  TIPS_SEND_HOUR: string;          // local hour (America/New_York) tips go out, or "" to send as soon as due
  TIPS_PER_DAY: string;            // most tip emails sent in one day; the rest wait for tomorrow
  TIPS_FROM: string;
  TIPS_REPLY_LOCAL: string;        // replies go to <this>+<id>@TIPS_REPLY_DOMAIN
  TIPS_REPLY_DOMAIN: string;
  WORKER_URL: string;              // this Worker's own address, for links in emails
}
