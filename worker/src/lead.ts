export type Turn = { role: "user" | "assistant"; content: string };
// name, email, business and goal are required; website and phone are optional and may be empty strings.
export type Lead = { name: string; email: string; business: string; website: string; phone: string; goal: string };
export type ChatResult = { reply: string; lead: Lead | null };

// Words that mean a visitor may be in crisis. When any of their messages matches, no lead card is shown
// for the rest of the conversation, whatever the model returns. Deliberately broad: a false match only
// means the visitor isn't offered the card, and they can still email directly.
const CRISIS = /\b(suicid\w*|kill(ing)? myself|end(ing)? (it all|my life)|want(ed)? to die|self[- ]?harm\w*|hurt(ing)? myself|cut(ting)? myself|overdos\w*|not safe|unsafe at home|in danger|being (hurt|abused|threatened)|abus(e|ive) (partner|relationship))\b/i;

export function mentionsCrisis(turns: Turn[]): boolean {
  return turns.some((t) => t.role === "user" && CRISIS.test(t.content));
}

// Only pass a lead to the browser when the required fields are present and the email looks real.
// Optional fields are kept only when they look sensible; otherwise they're left empty.
export function cleanLead(f: Lead): Lead | null {
  const t = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);
  const lead = {
    name: t(f.name, 80), email: t(f.email, 120), business: t(f.business, 120),
    website: t(f.website, 120), phone: t(f.phone, 30), goal: t(f.goal, 500),
  };
  if (!lead.name || !lead.business || !lead.goal) return null;
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(lead.email)) return null;
  // A phone number needs at least 7 digits and only phone-like characters.
  if (lead.phone && !(/^[\d\s()+.\-x]+$/i.test(lead.phone) && (lead.phone.match(/\d/g) ?? []).length >= 7)) lead.phone = "";
  return lead;
}
