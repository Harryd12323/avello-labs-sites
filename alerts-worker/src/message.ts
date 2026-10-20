// Builds the Telegram alert text. Pure functions so the formatting and cleaning can be unit tested.
// Alerts are plain text (no Telegram formatting), and every field is cleaned so a visitor can't add
// extra lines, fake "Email copy: sent" lines, or invisible direction-changing characters.

export type AlertInput = {
  tool: "chat" | "site-check";
  name: string;
  email: string;
  business: string;
  website: string;
  wants: string;
  emailSent: boolean;
};

const TOOL_NAME = { chat: "Chat assistant", "site-check": "Free site check" } as const;

// Control characters, zero-width characters, line/paragraph separators and bidirectional overrides.
// Built from code points so the source file itself contains no invisible characters.
const INVISIBLE = new RegExp(
  "[" + [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]]
    .map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("") + "]",
  "g",
);

/** One line of text: control and bidirectional-override characters removed, whitespace collapsed, length capped. */
export function clean(value: unknown, max: number): string {
  const s = String(value ?? "")
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function formatAlert(a: AlertInput): string {
  return [
    `New lead · ${TOOL_NAME[a.tool]}`,
    `Name: ${clean(a.name, 80) || "Not given"}`,
    `Business: ${clean(a.business, 120) || "Not given"}`,
    `Email: ${clean(a.email, 120)}`,
    `Website: ${clean(a.website, 220) || "Not given"}`,
    `Wants: ${clean(a.wants, 500) || "Not given"}`,
    `Email copy: ${a.emailSent ? "sent" : "FAILED, check Web3Forms and follow up from this alert"}`,
  ].join("\n");
}

export const PAUSED_NOTICE =
  "Lead alerts are paused for the rest of this hour because the alert limit was reached. Leads still arrive by email. If this keeps happening, someone may be sending fake leads.";
