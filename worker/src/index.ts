import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { Limiter } from "./limiter";
import { SYSTEM_PROMPT } from "./prompt";
import { mockReply } from "./mock";
import { cleanLead, mentionsCrisis, type ChatResult, type Turn } from "./lead";
import { signTicket, leadHash, CHAT_TICKET_SECONDS } from "../../workers-shared/ticket";

export { Limiter };

export interface Env {
  LIMITER: DurableObjectNamespace<Limiter>;
  ANTHROPIC_API_KEY?: string;
  LEAD_SIGNING_KEY?: string;
  MOCK?: string;
  ALLOWED_ORIGINS: string;
  PER_IP_PER_HOUR: string;
  DAILY_CAP: string;
  MAX_MESSAGE_CHARS: string;
  MAX_TURNS: string;
}


const MODEL = "claude-haiku-5-5";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_ASSISTANT_CHARS = 1500;
const CONTACT = "You can always email harris@avellolabs.com.";

const Reply = z.object({
  reply: z.string(),
  lead_ready: z.boolean(),
  name: z.string(),
  email: z.string(),
  business: z.string(),
  website: z.string(),
  phone: z.string(),
  goal: z.string(),
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
    if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403 });
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

    if (url.pathname !== "/chat") return json({ error: "not_found" }, 404);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    // Validate the conversation before spending anything on it.
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large", reply: "That message is too long. " + CONTACT }, 413);
    let turns: Turn[];
    try {
      turns = validate(JSON.parse(raw), Number(env.MAX_MESSAGE_CHARS), Number(env.MAX_TURNS));
    } catch (e) {
      const reply = e instanceof LimitError ? e.message : "Sorry, something went wrong with that message.";
      return json({ error: "bad_request", reply }, 400);
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const limiter = env.LIMITER.get(env.LIMITER.idFromName("global"));
    const verdict = await limiter.consume(ip, Number(env.PER_IP_PER_HOUR), Number(env.DAILY_CAP));
    if (!verdict.ok) {
      const reply = verdict.reason === "daily_cap"
        ? `The assistant has answered all the questions it can for today. ${CONTACT}`
        : `You've sent a lot of messages in the last hour, so let's take a short break. ${CONTACT}`;
      return json({ error: "rate_limited", reply }, 429, { "Retry-After": String(verdict.retryAfterSeconds) });
    }

    // Never offer a lead card in a crisis conversation. Every lead that is offered gets a signed ticket,
    // which the alerts Worker needs before it will send Harris a Telegram alert about it.
    const safe = async (r: ChatResult): Promise<ChatResult & { ticket?: string }> => {
      const out = mentionsCrisis(turns) ? { ...r, lead: null } : r;
      if (!out.lead || !env.LEAD_SIGNING_KEY) return out;
      const h = await leadHash(out.lead);
      return { ...out, ticket: await signTicket(env.LEAD_SIGNING_KEY, { tool: "chat", h }, CHAT_TICKET_SECONDS) };
    };

    if (env.MOCK === "1") return json(await safe(mockReply(turns)));
    if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured", reply: `The assistant isn't available right now. ${CONTACT}` }, 503);

    try {
      return json(await safe(await askClaude(env.ANTHROPIC_API_KEY, turns)));
    } catch (error) {
      // Log only the error type and status, never the conversation.
      const status = error instanceof Anthropic.APIError ? error.status : undefined;
      console.error("anthropic_error", error instanceof Error ? error.constructor.name : "unknown", status ?? "");
      const busy = error instanceof Anthropic.RateLimitError || (typeof status === "number" && status >= 500);
      const reply = busy ? `The assistant is busy right now. Please try again in a minute. ${CONTACT}` : `Sorry, I couldn't answer that just now. ${CONTACT}`;
      return json({ error: "upstream", reply }, 502);
    }
  },
};

class LimitError extends Error {}

function validate(body: unknown, maxChars: number, maxTurns: number): Turn[] {
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("no messages");
  if (messages.length > maxTurns) throw new LimitError(`This chat has reached its length limit. Please start a new chat. ${CONTACT}`);
  return messages.map((m, i) => {
    const role = (m as Turn)?.role, content = (m as Turn)?.content;
    if (role !== (i % 2 === 0 ? "user" : "assistant")) throw new Error("turns must alternate, starting with the visitor");
    if (typeof content !== "string" || !content.trim()) throw new Error("empty message");
    if (role === "user" && content.length > maxChars) throw new LimitError(`Please keep messages under ${maxChars} characters.`);
    if (role === "assistant" && content.length > MAX_ASSISTANT_CHARS) throw new Error("assistant turn too long");
    if (i === messages.length - 1 && role !== "user") throw new Error("last message must be from the visitor");
    return { role, content };
  });
}

async function askClaude(apiKey: string, turns: Turn[]): Promise<ChatResult> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 300,
    // Thinking off and low effort: short, quick replies that use the whole token budget for the answer.
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: zodOutputFormat(Reply) },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: turns,
  });

  if (response.stop_reason === "refusal") {
    return { reply: `Sorry, I can't help with that one. I'm happy to answer questions about Avello Labs and its services. ${CONTACT}`, lead: null };
  }
  const out = response.parsed_output;
  if (!out || !out.reply.trim()) {
    return { reply: `Sorry, I lost my train of thought there. Could you ask that again? ${CONTACT}`, lead: null };
  }
  const lead = out.lead_ready ? cleanLead(out) : null;
  return { reply: out.reply.trim(), lead };
}
