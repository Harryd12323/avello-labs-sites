// The web side of the tip emails: the confirm, unsubscribe and stop links, Resend's webhook for replies, the
// site's "they booked" ping, and the one-off backfill. These routes are opened from emails and mail apps, so
// they don't need an allowed Origin (POST /tips/stop, called by the site, does).

import type { Env } from "./env";
import type { Guide } from "./quiz";
import { sendEmail, sendTelegram } from "./send";
import type { StopReason } from "./tipslist";
import { backfillKey, isAutoReply, page, parseBackfill, renderConfirm, replyId, signLink, verifyLink, verifyWebhook } from "./tips";

const tips = (env: Env) => env.TIPS.get(env.TIPS.idFromName("global"));

/** A quiz signup ticked the box. Returns the links for the guide email and Harris's copy, or null if their
 *  tips are already going out or tips aren't set up. */
export async function tipsSignup(env: Env, email: string, name: string, guide: Guide): Promise<{ confirmUrl: string; stopUrl: string } | null> {
  if (!env.TIPS_SIGNING_KEY) return null;
  const id = await tips(env).signup(email, name, guide);
  if (!id) return null;
  return {
    confirmUrl: `${env.WORKER_URL}/tips/confirm?t=${await signLink(env.TIPS_SIGNING_KEY, "c", id)}`,
    stopUrl: `${env.WORKER_URL}/tips/stop-one?t=${await signLink(env.TIPS_SIGNING_KEY, "s", id)}`,
  };
}

/** Stops someone's tips by email, for example when they book a call or send a lead through the chat. */
export async function stopTipsFor(env: Env, email: string, reason: StopReason): Promise<string | null> {
  return env.TIPS_SIGNING_KEY ? tips(env).stop({ email }, reason) : null;
}

const REASON_TEXT: Record<StopReason, string> = {
  unsubscribed: "unsubscribed", replied: "replied to a tip email", booked: "booked a call", manual: "stopped by you", send_failed: "sending failed",
};

/** Handles /tips/... paths, or returns null for anything else. */
export async function handleTips(request: Request, env: Env, url: URL, json: (body: unknown, status?: number) => Response): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith("/tips/")) return null;
  if (!env.TIPS_SIGNING_KEY) return new Response("Not available", { status: 503 });
  const token = url.searchParams.get("t");
  const post = request.method === "POST";
  const self = `${path}?t=${encodeURIComponent(token ?? "")}`;

  if (path === "/tips/confirm") {
    const id = await verifyLink(env.TIPS_SIGNING_KEY, "c", token);
    if (!id) return page("This link doesn't work", "It may have been copied incompletely. If you still want the tips, take the quiz again and tick the box.");
    // Opening the link only shows a button: email security scanners open links on their own, and they
    // mustn't be able to confirm for someone.
    if (!post) return page("One more tap", "Confirm and we'll send you 5 short website tips over the next few weeks. Every one has a link to unsubscribe.", { action: self, label: "Yes, send me the tips" });
    const r = await tips(env).confirm(id);
    if (r.result === "missing") return page("This link has expired", "Confirm links work for 7 days. If you still want the tips, take the quiz again and tick the box.");
    if (r.result === "confirmed") {
      const stop = `${env.WORKER_URL}/tips/stop-one?t=${await signLink(env.TIPS_SIGNING_KEY, "s", id)}`;
      await sendTelegram(env, `Tip emails: ${r.email} confirmed. The first tip goes out in about 2 days.\nIf they get in touch another way, stop their tips: ${stop}`);
    }
    return page("You're in", "Your first tip arrives in a couple of days. Every email has a link to unsubscribe.");
  }

  if (path === "/tips/unsubscribe") {
    // Opening the link shows one button, because email security scanners open links on their own and mustn't
    // unsubscribe anyone. The POST from that button, or from a mail app's own Unsubscribe button (RFC 8058,
    // List-Unsubscribe-Post), unsubscribes straight away.
    const id = await verifyLink(env.TIPS_SIGNING_KEY, "u", token);
    if (!id) return page("This link doesn't work", "It may have been copied incompletely. Reply “unsubscribe” to any tip email and we'll stop.");
    if (!post) return page("Unsubscribe from the tips?", "We won't send you any more of the website tips.", { action: self, label: "Unsubscribe" });
    const email = await tips(env).stop({ id }, "unsubscribed");
    if (email) await sendTelegram(env, `Tip emails: ${email} unsubscribed.`);
    return page("You're unsubscribed", "We won't send you any more tips.");
  }

  if (path === "/tips/stop-one") {
    // Harris's link in his copy of the quiz answers. A button first, for the same reason as confirm.
    const id = await verifyLink(env.TIPS_SIGNING_KEY, "s", token);
    if (!id) return page("This link doesn't work", "It may have been copied incompletely.");
    if (!post) return page("Stop their tip emails?", "They won't get any more tips from the quiz sequence.", { action: self, label: "Stop the tips" });
    const email = await tips(env).stop({ id }, "manual");
    return page(email ? "Stopped" : "Nothing to stop", email ? `No more tips will go to ${email}.` : "Their tips had already finished or stopped.");
  }

  if (path === "/tips/inbound" && post) return inbound(request, env);

  if (path === "/tips/backfill" && post) {
    if (!env.TIPS_BACKFILL || !env.RESEND_API_KEY) return json({ error: "nothing_to_do" }, 404);
    // Locked to whoever has the list: the key is the first 16 characters of the list's SHA-256 (see backfillKey).
    if (url.searchParams.get("key") !== (await backfillKey(env.TIPS_BACKFILL))) return json({ error: "bad_key" }, 403);
    const added = await tips(env).backfill(parseBackfill(env.TIPS_BACKFILL));
    let sent = 0;
    for (const a of added) {
      const confirmUrl = `${env.WORKER_URL}/tips/confirm?t=${await signLink(env.TIPS_SIGNING_KEY, "c", a.id)}`;
      if (await sendEmail(env, { from: env.TIPS_FROM, to: [a.email], reply_to: env.QUIZ_TO, ...renderConfirm({ name: a.name, confirmUrl }) }, `tips-backfill-${a.id}`)) sent++;
    }
    await sendTelegram(env, `Tip emails: sent ${sent} of ${added.length} confirm emails to people who ticked the box before launch.`);
    return json({ added: added.length, sent });
  }

  if (path === "/tips/debug" && env.TIPS_DAY_SECONDS !== "86400") return json(await tips(env).debugList());
  return null;
}

/** Resend's "email received" webhook: someone replied to a tip email (or used the mailto unsubscribe). Their
 *  reply already reached Harris through the first reply-to address, so this only stops the tips. */
async function inbound(request: Request, env: Env): Promise<Response> {
  if (!env.RESEND_WEBHOOK_SECRET) return new Response("Not configured", { status: 503 });
  const body = await request.text();
  if (body.length > 256 * 1024) return new Response("Too large", { status: 413 });
  const ok = await verifyWebhook(env.RESEND_WEBHOOK_SECRET, {
    id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature"),
  }, body);
  if (!ok) return new Response("Bad signature", { status: 401 });
  let event: { type?: string; data?: { from?: unknown; to?: unknown; received_for?: unknown; subject?: unknown } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (event.type !== "email.received" || !event.data) return new Response("Ignored");
  const to = [...(Array.isArray(event.data.to) ? event.data.to : []), ...(Array.isArray(event.data.received_for) ? event.data.received_for : [])];
  const id = replyId(to, env.TIPS_REPLY_LOCAL, env.TIPS_REPLY_DOMAIN);
  // Every receiving webhook gets every email to the domain, so mail for the other Worker (test or live) is skipped.
  if (!id) return new Response("Not ours");
  // Out-of-office and other automatic replies aren't the person replying, so they don't stop the tips.
  if (isAutoReply(event.data.from, event.data.subject)) {
    console.log("tips_inbound", JSON.stringify({ id, ignored: "auto_reply" }));
    return new Response("Ignored auto-reply");
  }
  const unsubscribe = typeof event.data.subject === "string" && /\bunsubscribe\b/i.test(event.data.subject);
  const reason: StopReason = unsubscribe ? "unsubscribed" : "replied";
  let email = await tips(env).stop({ id }, reason);
  const from = typeof event.data.from === "string" ? event.data.from.replace(/^.*<|>.*$/g, "").trim() : "";
  if (!email && from) email = await tips(env).stop({ email: from }, reason);
  // Logs the subscriber ID and outcome only (no addresses), to check replies are being matched.
  console.log("tips_inbound", JSON.stringify({ id, reason, stopped: !!email }));
  if (email) await sendTelegram(env, `Tip emails: ${email} ${REASON_TEXT[reason]}, so the rest are stopped.${reason === "replied" ? " Their reply is in your inbox." : ""}`);
  return new Response("OK");
}
