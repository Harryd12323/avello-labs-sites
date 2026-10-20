import { DurableObject } from "cloudflare:workers";

// Decides whether a lead alert may be sent: each ticket works once, the same email and tool alert at most
// once an hour, each visitor at most N times an hour, and there are hourly and daily totals. Stores only
// used ticket IDs (until they expire), salted hashes and counts. An hourly alarm cleans up.

export type Limits = { perIpPerHour: number; perHour: number; perDay: number };
export type GateResult =
  | { ok: true }
  | { ok: false; reason: "used" | "duplicate" | "ip" | "global"; notifyPause: boolean };

const HOUR = 3600_000;

export class AlertGate extends DurableObject {
  async consume(nonce: string, expSeconds: number, ip: string, dedupe: string, limits: Limits): Promise<GateResult> {
    const now = Date.now();
    const hour = Math.floor(now / HOUR);
    const day = new Date(now).toISOString().slice(0, 10);
    const nKey = `n:${nonce}`;
    const ipKey = `ip:${hour}:${await this.hash("ip|" + ip)}`;
    const dKey = `d:${await this.hash("d|" + dedupe)}`;
    const hKey = `gh:${hour}`, dayKey = `gd:${day}`, pKey = `pn:${hour}`;
    const got = await this.ctx.storage.get<number>([nKey, ipKey, dKey, hKey, dayKey, pKey]);
    const v = (k: string) => got.get(k) ?? 0;

    if (got.has(nKey)) return { ok: false, reason: "used", notifyPause: false };
    // From here on the ticket counts as used, whatever the outcome.
    const writes: Record<string, number> = { [nKey]: expSeconds * 1000 };

    let result: GateResult;
    if (now - v(dKey) < HOUR) {
      result = { ok: false, reason: "duplicate", notifyPause: false };
    } else if (v(ipKey) >= limits.perIpPerHour) {
      result = { ok: false, reason: "ip", notifyPause: false };
    } else if (v(hKey) >= limits.perHour || v(dayKey) >= limits.perDay) {
      const notify = !got.has(pKey);
      if (notify) writes[pKey] = 1;
      result = { ok: false, reason: "global", notifyPause: notify };
    } else {
      writes[ipKey] = v(ipKey) + 1;
      writes[dKey] = now;
      writes[hKey] = v(hKey) + 1;
      writes[dayKey] = v(dayKey) + 1;
      result = { ok: true };
    }
    await this.ctx.storage.put(writes);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + HOUR);
    return result;
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const hour = Math.floor(now / HOUR);
    const today = new Date(now).toISOString().slice(0, 10);
    const stale: string[] = [];
    for (const [k, v] of await this.ctx.storage.list<number>({ prefix: "n:" })) if (v < now) stale.push(k);
    for (const [k, v] of await this.ctx.storage.list<number>({ prefix: "d:" })) if (now - v >= HOUR) stale.push(k);
    for (const prefix of ["ip:", "gh:", "pn:"]) {
      for (const k of (await this.ctx.storage.list({ prefix })).keys()) if (Number(k.split(":")[1]) < hour) stale.push(k);
    }
    for (const k of (await this.ctx.storage.list({ prefix: "gd:" })).keys()) if (k.slice(3) < today) stale.push(k);
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
