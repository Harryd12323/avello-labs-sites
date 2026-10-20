import { DurableObject } from "cloudflare:workers";

// Decides whether an alert may be sent. Each ticket works once; each kind of alert ("lead" or "newsletter")
// has its own per-visitor, hourly and daily caps and its own duplicate window for the same email. It also
// keeps a monthly count of alerts whose email copy was sent, to warn before the Web3Forms free plan runs
// out. Stores only used ticket IDs, salted hashes and counts; an hourly alarm deletes expired entries.

export type Kind = "lead" | "newsletter";
export type Limits = { perIpPerHour: number; perHour: number; perDay: number; dedupeMs: number; pauseFor: "hour" | "day" };
export type GateResult =
  | { ok: true; monthCount: number }
  | { ok: false; reason: "used" | "duplicate" | "ip" | "global"; notifyPause: boolean };

const HOUR = 3600_000;

export class AlertGate extends DurableObject {
  async consume(kind: Kind, nonce: string, expSeconds: number, ip: string, dedupe: string, emailSent: boolean, limits: Limits): Promise<GateResult> {
    const now = Date.now();
    const hour = Math.floor(now / HOUR);
    const day = new Date(now).toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const nKey = `n:${nonce}`;
    const ipKey = `ip:${hour}:${kind}:${await this.hash("ip|" + ip)}`;
    const dKey = `d:${kind}:${await this.hash("d|" + dedupe)}`;
    const hKey = `gh:${hour}:${kind}`, dayKey = `gd:${day}:${kind}`;
    const pKey = `pn:${limits.pauseFor === "day" ? day : hour}:${kind}`;
    const mKey = `m:${month}`;
    const got = await this.ctx.storage.get<number>([nKey, ipKey, dKey, hKey, dayKey, pKey, mKey]);
    const v = (k: string) => got.get(k) ?? 0;

    if (got.has(nKey)) return { ok: false, reason: "used", notifyPause: false };
    // From here on the ticket counts as used, whatever the outcome. Entries that expire store their expiry time.
    const writes: Record<string, number> = { [nKey]: expSeconds * 1000 };

    let result: GateResult;
    if (now < v(dKey)) {
      result = { ok: false, reason: "duplicate", notifyPause: false };
    } else if (v(ipKey) >= limits.perIpPerHour) {
      result = { ok: false, reason: "ip", notifyPause: false };
    } else if (v(hKey) >= limits.perHour || v(dayKey) >= limits.perDay) {
      const notify = !got.has(pKey);
      if (notify) writes[pKey] = now + (limits.pauseFor === "day" ? 24 * HOUR : HOUR);
      result = { ok: false, reason: "global", notifyPause: notify };
    } else {
      writes[ipKey] = v(ipKey) + 1;
      writes[dKey] = now + limits.dedupeMs;
      writes[hKey] = v(hKey) + 1;
      writes[dayKey] = v(dayKey) + 1;
      if (emailSent) writes[mKey] = v(mKey) + 1;
      result = { ok: true, monthCount: emailSent ? v(mKey) + 1 : v(mKey) };
    }
    await this.ctx.storage.put(writes);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + HOUR);
    return result;
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const hour = Math.floor(now / HOUR);
    const today = new Date(now).toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);
    const stale: string[] = [];
    for (const prefix of ["n:", "d:", "pn:"]) {
      for (const [k, v] of await this.ctx.storage.list<number>({ prefix })) if (v < now) stale.push(k);
    }
    for (const prefix of ["ip:", "gh:"]) {
      for (const k of (await this.ctx.storage.list({ prefix })).keys()) if (Number(k.split(":")[1]) < hour) stale.push(k);
    }
    for (const k of (await this.ctx.storage.list({ prefix: "gd:" })).keys()) if (k.slice(3, 13) < today) stale.push(k);
    for (const k of (await this.ctx.storage.list({ prefix: "m:" })).keys()) if (k.slice(2) < thisMonth) stale.push(k);
    for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
    if ((await this.ctx.storage.list({ limit: 2 })).size > 1) await this.ctx.storage.setAlarm(now + HOUR);
  }

  private async hash(value: string): Promise<string> {
    let salt = await this.ctx.storage.get<string>("salt");
    if (!salt) {
      salt = crypto.randomUUID();
      await this.ctx.storage.put("salt", salt);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${value}`));
    return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
