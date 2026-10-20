// robots.txt rules for the AI crawler check, following RFC 9309 (the Robots Exclusion Protocol):
// - Groups start with one or more User-agent lines. A User-agent line after rules starts a new group.
// - A crawler obeys the group(s) whose user-agent matches its product token (case-insensitive). Several
//   matching groups are combined. If none match, it obeys the "*" group. If there's no "*" group either,
//   everything is allowed.
// - The longest matching rule wins. If an Allow and a Disallow rule match with the same length, Allow wins.
// - "*" matches any characters and "$" anchors the end of the path. Empty rules are ignored.
// Pure functions, no Worker APIs, so the rules can be unit tested in Node.

export type Rule = { allow: boolean; pattern: string; line: string };
export type Group = { agents: string[]; rules: Rule[] };
export type Verdict = { allowed: boolean; rule: string | null; group: string | null };

// A byte-order mark at the very start of the file is ignored (built from its code point to keep the source plain).
const BOM = new RegExp("^" + String.fromCharCode(0xfeff));

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(BOM, "").split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current || value === "") continue; // rules before any group, and empty rules, are ignored
      current.rules.push({ allow: key === "allow", pattern: value, line: `${key === "allow" ? "Allow" : "Disallow"}: ${value}` });
    }
    // Other lines (Sitemap, Crawl-delay, ...) don't belong to groups and, as in Google's reference parser,
    // don't split a run of User-agent lines.
  }
  return groups;
}

/** Does `pattern` match the start of `path`? "*" is a wildcard and a trailing "$" anchors the end. */
export function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp("^" + re + (anchored ? "$" : "")).test(path);
}

/** What a crawler with this product token may do on `path`, given parsed robots.txt groups. */
export function evaluate(groups: Group[], token: string, path: string): Verdict {
  const t = token.toLowerCase();
  let matched = groups.filter((g) => g.agents.includes(t));
  let groupName: string | null = token;
  if (!matched.length) {
    matched = groups.filter((g) => g.agents.includes("*"));
    groupName = matched.length ? "*" : null;
  }
  if (!matched.length) return { allowed: true, rule: null, group: null };

  let best: Rule | null = null;
  for (const rule of matched.flatMap((g) => g.rules)) {
    if (!ruleMatches(rule.pattern, path)) continue;
    const len = rule.pattern.length;
    if (!best || len > best.pattern.length || (len === best.pattern.length && rule.allow && !best.allow)) best = rule;
  }
  return { allowed: best ? best.allow : true, rule: best ? best.line : null, group: groupName };
}
