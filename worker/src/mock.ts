import { cleanLead, mentionsCrisis, type ChatResult, type Lead, type Turn } from "./lead";

// Mock mode (`npm run dev`): canned replies, no API key, no cost. It still goes through every guard
// (origin, length, turn and rate limits), and it walks through the same lead flow as the real assistant
// so the chat window can be tested end to end. Every reply is labelled so it can't be mistaken for Claude.

const ASK_NAME_EMAIL = "your name and email";
const ASK_BUSINESS = "what's your business called, and does it have a website yet";
const ASK_PHONE = "a phone number too, if you'd prefer a call";
const ASK_GOAL = "main thing you'd like help with";

export function mockReply(turns: Turn[]): ChatResult {
  const last = turns[turns.length - 1].content;
  const text = last.toLowerCase();
  const fields: Partial<Lead> = {};
  let collecting = false, askedPhone = false;

  // Read the details out of answers to the questions this mock asked earlier.
  for (let i = 1; i < turns.length; i += 2) {
    const asked = turns[i].content, answer = turns[i + 1]?.content ?? "";
    if (asked.includes(ASK_NAME_EMAIL)) {
      collecting = true;
      const email = answer.match(/[^\s@,]+@[^\s@,]+\.[a-z]{2,}/i)?.[0];
      if (email) fields.email = email;
      const name = answer.replace(email ?? "", "").replace(/\b(my name is|i'm|i am|it's|and|email)\b/gi, "").replace(/[,.:;]+/g, " ").trim();
      if (name) fields.name = name.split(/\s+/).slice(0, 3).join(" ");
    } else if (asked.includes(ASK_BUSINESS)) {
      collecting = true;
      const site = answer.match(/\b(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?/i)?.[0];
      const none = /\b(no|none|not yet|don't have|dont have)\b/i.test(answer);
      fields.website = site ?? (none ? "none yet" : "");
      fields.business = answer.replace(site ?? "", "").replace(/\b(it's called|we're|called|and|our site is|website is|no website( yet)?|none yet|not yet|we don't have one( yet)?)\b/gi, "").replace(/[,.;:]+/g, " ").replace(/\s+/g, " ").trim();
    } else if (asked.includes(ASK_PHONE)) {
      collecting = true;
      askedPhone = true;
      const phone = answer.match(/\+?[\d\s().\-]{7,}/)?.[0];
      fields.phone = phone ? phone.trim() : "";
    } else if (asked.includes(ASK_GOAL)) {
      collecting = true;
      fields.goal = answer.trim();
    }
  }

  const wantsContact = /\b(contact|get in touch|work with|hire|quote|talk to|follow up|call me|reach out|interested)\b/.test(text);
  const reply = (s: string, lead: Lead | null = null): ChatResult => ({ reply: `[Mock reply] ${s}`, lead });

  if (mentionsCrisis([turns[turns.length - 1]])) {
    return reply("I'm really sorry you're going through this, and you don't have to face it alone. You can call or text 988, the Suicide & Crisis Lifeline in the US, any time. If you're in immediate danger, please call 911, or your local emergency number.");
  }
  if (mentionsCrisis(turns)) collecting = false;
  if (/ignore (all|your|previous)|system prompt|your instructions|pretend you|jailbreak/.test(text)) {
    return reply("I'm Avello Labs' website assistant, so I can only help with questions about its services, like SEO, AEO, website care and custom web apps.");
  }
  if (/\b(poem|homework|recipe|weather|joke|bitcoin|essay)\b/.test(text)) {
    return reply("That's outside what I can help with here. I'm happy to answer questions about Avello Labs, SEO, AEO, website care or custom web apps, though.");
  }

  if ((collecting || wantsContact) && !mentionsCrisis(turns)) {
    if (!fields.name || !fields.email) return reply(`Happy to have Harris follow up. To start, could you share ${ASK_NAME_EMAIL}?`);
    if (!fields.business) return reply(`Nice to meet you, ${fields.name}. So ${ASK_BUSINESS}? "None yet" is a fine answer.`);
    if (!askedPhone) return reply(`Got it, thanks. You're welcome to share ${ASK_PHONE}. Totally optional, so feel free to skip it.`);
    if (!fields.goal) return reply(`Thanks. Last one: what's the ${ASK_GOAL}?`);
    const lead = cleanLead(fields as Lead);
    if (lead) return reply("Thanks! Please check your details below and press \"Send to Harris\" when they look right.", lead);
    return reply(`That email doesn't look quite right. Could you share ${ASK_NAME_EMAIL} again?`);
  }

  if (/\b(price|pricing|cost|how much|cheap|expensive|rate)\b/.test(text)) {
    return reply("I can't quote prices here. Harris gives a clear quote after learning about your business. Would you like him to follow up?");
  }
  if (/\baeo\b|chatgpt|ai answer|answer engine/.test(text)) {
    return reply("AEO is about making your business easy for AI tools like ChatGPT and Google's AI answers to understand and recommend. There's a plain-English guide at https://avellolabs.com/aeo/");
  }
  if (/\bseo\b|google|rank/.test(text)) {
    return reply("For local businesses, Google weighs relevance, distance and prominence. Nobody can guarantee rankings, but a complete Business Profile, clear service pages and reviews all help. More at https://avellolabs.com/seo/");
  }
  if (/web ?app|portal|tracker|dashboard|spreadsheet|tool/.test(text)) {
    return reply("A web app helps you run your business, like a customer portal, an order tracker or an intake form, and it runs in the browser with nothing to install. See https://avellolabs.com/web-apps/");
  }
  if (/care|update|maintenance|broken|backup|security|speed/.test(text)) {
    return reply("Ongoing site care covers updates, security, speed, backups and keeping your hours and services current, so problems get caught early. More at https://avellolabs.com/website-care/");
  }
  return reply("I can answer questions about SEO, AEO, website care and custom web apps, or pass a message to Harris. What would you like to know?");
}
