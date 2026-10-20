import { DurableObject } from "cloudflare:workers";

// Rate-limit counters for the website check: per visitor per hour, per checked site per hour, and a daily
// total. It stores only salted hashes of the visitor's IP and the checked hostname, plus counts. An hourly
// alarm deletes expired buckets. Visitor URLs are never stored.

export type LimitResult = { ok: true } | { ok: false; reason: "ip_hourly" | "target_hourly" | "daily_cap"; retryAfterSeconds: number };
export type Limits = { perIpPerHour: number; perTargetPerHour: number; dailyCap: number };

const HOUR = 3600_000;

export class Limiter extends DurableObject {
  async consume(ip: string, target: string, limits: Limits): Promise<LimitResult> {
    const now = Date.now();
    const hour = Math.floor(now / HOUR);
    const day = new Date(now).toISOString().slice(0, 10);
    const ipKey = `ip:${hour}:${await this.hash("ip|" + ip)}`;
    const targetKey = `t:${hour}:${await this.hash("t|" + target)}`;
    const dayKey = `day:${day}`;
    const got = await this.ctx.storage.get<number>([ipKey, targetKey, dayKey]);
    const [ipN, tN, dayN] = [got.get(ipKey) ?? 0, got.get(targetKey) ?? 0, got.get(dayKey) ?? 0];
    const toNextHour = Math.ceil(((hour + 1) * HOUR - now) / 1000);

    if (dayN >= limits.dailyCap) {
      const d = new Date(now);
      const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      return { ok: false, reason: "daily_cap", retryAfterSeconds: Math.ceil((midnight - now) / 1000) };
    }
    if (ipN >= limits.perIpPerHour) return { ok: false, reason: "ip_hourly", retryAfterSeconds: toNextHour };
    if (tN >= limits.perTargetPerHour) return { ok: false, reason: "target_hourly", retryAfterSeconds: toNextHour };

    await this.ctx.storage.put({ [ipKey]: ipN + 1, [targetKey]: tN + 1, [dayKey]: dayN + 1 });
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + HOUR);
    return { ok: true };
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const hour = Math.floor(now / HOUR);
    const today = new Date(now).toISOString().slice(0, 10);
    const stale: string[] = [];
    for (const prefix of ["ip:", "t:"]) {
      for (const key of (await this.ctx.storage.list({ prefix })).keys()) if (Number(key.split(":")[1]) < hour) stale.push(key);
    }
    for (const key of (await this.ctx.storage.list({ prefix: "day:" })).keys()) if (key.slice(4) < today) stale.push(key);
    for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
    const left = (await this.ctx.storage.list({ limit: 2 })).size; // "salt" is always there
    if (left > 1) await this.ctx.storage.setAlarm(now + HOUR);
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
