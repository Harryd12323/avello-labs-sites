import { DurableObject } from "cloudflare:workers";

// Rate-limit counters for the chat assistant. One instance holds every counter, which is plenty at this
// traffic level and keeps the per-IP and global checks atomic. It stores only salted IP hashes and counts,
// and an hourly alarm deletes buckets once they've expired. No message content ever reaches it.

export type LimitResult =
  | { ok: true }
  | { ok: false; reason: "ip_hourly" | "daily_cap"; retryAfterSeconds: number };

const HOUR = 3600_000;

export class Limiter extends DurableObject {
  async consume(ip: string, perIpPerHour: number, dailyCap: number): Promise<LimitResult> {
    const now = Date.now();
    const hourBucket = Math.floor(now / HOUR);
    const day = new Date(now).toISOString().slice(0, 10);
    const ipKey = `ip:${hourBucket}:${await this.hash(ip)}`;
    const dayKey = `day:${day}`;

    const [ipCount, dayCount] = await Promise.all([
      this.ctx.storage.get<number>(ipKey),
      this.ctx.storage.get<number>(dayKey),
    ]);

    if ((dayCount ?? 0) >= dailyCap) {
      const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
      return { ok: false, reason: "daily_cap", retryAfterSeconds: Math.ceil((midnight - now) / 1000) };
    }
    if ((ipCount ?? 0) >= perIpPerHour) {
      return { ok: false, reason: "ip_hourly", retryAfterSeconds: Math.ceil(((hourBucket + 1) * HOUR - now) / 1000) };
    }

    await this.ctx.storage.put({ [ipKey]: (ipCount ?? 0) + 1, [dayKey]: (dayCount ?? 0) + 1 });
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + HOUR);
    return { ok: true };
  }

  // Deletes hourly IP buckets older than the current hour and day counters older than today.
  async alarm(): Promise<void> {
    const now = Date.now();
    const hourBucket = Math.floor(now / HOUR);
    const today = new Date(now).toISOString().slice(0, 10);
    const stale: string[] = [];
    for (const key of (await this.ctx.storage.list({ prefix: "ip:" })).keys()) {
      if (Number(key.split(":")[1]) < hourBucket) stale.push(key);
    }
    for (const key of (await this.ctx.storage.list({ prefix: "day:" })).keys()) {
      if (key.slice(4) < today) stale.push(key);
    }
    for (let i = 0; i < stale.length; i += 128) await this.ctx.storage.delete(stale.slice(i, i + 128));
    const remaining = (await this.ctx.storage.list({ limit: 1, prefix: "ip:" })).size;
    if (remaining > 0 || (await this.ctx.storage.list({ limit: 1, prefix: "day:" })).size > 0) {
      await this.ctx.storage.setAlarm(now + HOUR);
    }
  }

  // Salted SHA-256 of the IP. The salt is random, generated once, and never leaves this object.
  private async hash(ip: string): Promise<string> {
    let salt = await this.ctx.storage.get<string>("salt");
    if (!salt) {
      salt = crypto.randomUUID();
      await this.ctx.storage.put("salt", salt);
    }
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}`));
    return [...new Uint8Array(bytes)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
