import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { Guide } from "./quiz";
import { sendEmail, sendTelegram } from "./send";
import { TIP_COUNT, dueAt, newId, renderTip, replyAddress, scheduleConfig, signLink } from "./tips";

// The list of quiz signups who asked for the 5 tip emails, and the sender. One instance ("global") holds
// everyone in a small SQLite table. An alarm wakes it when the next tip is due; it sends what's due (up to the
// daily cap), then sets the next alarm.
//
// Status: pending (ticked the box, not confirmed yet), active (confirmed, tips going out), done (all 5 sent),
// stopped (unsubscribed, replied, booked, or stopped by Harris). Unconfirmed signups are deleted after 7 days,
// and everyone else 30 days after their last tip or after they stop, so no list builds up.

const DAY = 24 * 3600_000;
const PENDING_DAYS = 7;
const KEEP_DAYS = 30;
const MAX_FAILURES = 5;

export type Status = "pending" | "active" | "done" | "stopped";
export type StopReason = "unsubscribed" | "replied" | "booked" | "manual" | "send_failed";
type Row = { id: string; email: string; name: string; guide: Guide; status: Status; step: number; guide_at: number; last_sent_at: number | null; failures: number };

export class TipsList extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS subscribers (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, guide TEXT NOT NULL,
        status TEXT NOT NULL, stop_reason TEXT, step INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, guide_at INTEGER NOT NULL, confirmed_at INTEGER,
        next_at INTEGER, last_sent_at INTEGER, ended_at INTEGER, failures INTEGER NOT NULL DEFAULT 0)`);
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sent_per_day (day TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    });
  }

  private sql<T extends Record<string, SqlStorageValue>>(query: string, ...args: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...args).toArray();
  }

  /** Someone ticked the box in the quiz. Returns their ID for the confirm link, or null if their tips are
   *  already going out (then the guide email has no confirm button). A finished or stopped subscriber who
   *  ticks the box again starts over as pending, so nothing is sent until they confirm again. */
  async signup(email: string, name: string, guide: Guide, now = Date.now()): Promise<string | null> {
    const key = email.trim().toLowerCase();
    const [row] = this.sql<{ id: string; status: Status }>("SELECT id, status FROM subscribers WHERE email = ?", key);
    if (row?.status === "active") return null;
    if (row) {
      this.sql(`UPDATE subscribers SET name = ?, guide = ?, status = 'pending', stop_reason = NULL, step = 0, created_at = ?, guide_at = ?,
        confirmed_at = NULL, next_at = NULL, last_sent_at = NULL, ended_at = NULL, failures = 0 WHERE id = ?`, name, guide, now, now, row.id);
      await this.ensureAlarm(now);
      return row.id;
    }
    const id = newId();
    this.sql("INSERT INTO subscribers (id, email, name, guide, status, created_at, guide_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)", id, key, name, guide, now, now);
    await this.ensureAlarm(now);
    return id;
  }

  /** People who ticked the box before confirming existed. Adds the ones not on the list yet, as pending,
   *  and returns them so the Worker can send each one confirm email. Running it twice adds nobody twice. */
  async backfill(entries: Array<{ email: string; name: string; guide: Guide }>, now = Date.now()): Promise<Array<{ id: string; email: string; name: string }>> {
    const added: Array<{ id: string; email: string; name: string }> = [];
    for (const e of entries) {
      const key = e.email.trim().toLowerCase();
      if (this.sql("SELECT id FROM subscribers WHERE email = ?", key).length) continue;
      const id = newId();
      this.sql("INSERT INTO subscribers (id, email, name, guide, status, created_at, guide_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)", id, key, e.name, e.guide, now, now);
      added.push({ id, email: key, name: e.name });
    }
    await this.ensureAlarm(now);
    return added;
  }

  /** They tapped "Yes, send me the tips". */
  async confirm(id: string, now = Date.now()): Promise<{ result: "confirmed" | "already" | "missing"; email?: string }> {
    const [row] = this.sql<{ email: string; status: Status; guide_at: number }>("SELECT email, status, guide_at FROM subscribers WHERE id = ?", id);
    if (!row || row.status === "stopped" || row.status === "done") return { result: "missing" };
    if (row.status === "active") return { result: "already", email: row.email };
    const next = dueAt(0, row.guide_at, now, null, scheduleConfig(this.env));
    this.sql("UPDATE subscribers SET status = 'active', confirmed_at = ?, next_at = ? WHERE id = ?", now, next, id);
    await this.ensureAlarm(now);
    return { result: "confirmed", email: row.email };
  }

  /** Stops their tips, by ID (links, reply address) or by email (a booking, or a reply from their own address).
   *  Returns their email if they had pending or active tips. */
  async stop(by: { id: string } | { email: string }, reason: StopReason, now = Date.now()): Promise<string | null> {
    const [row] = "id" in by
      ? this.sql<{ id: string; email: string; status: Status }>("SELECT id, email, status FROM subscribers WHERE id = ?", by.id)
      : this.sql<{ id: string; email: string; status: Status }>("SELECT id, email, status FROM subscribers WHERE email = ?", by.email.trim().toLowerCase());
    if (!row || (row.status !== "pending" && row.status !== "active")) return null;
    this.sql("UPDATE subscribers SET status = 'stopped', stop_reason = ?, next_at = NULL, ended_at = ? WHERE id = ?", reason, now, row.id);
    return row.email;
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    await this.sendDue(now);
    this.cleanUp(now);
    await this.ensureAlarm(now, true);
  }

  private async sendDue(now: number): Promise<void> {
    if (!this.env.RESEND_API_KEY || !this.env.TIPS_SIGNING_KEY) return;
    const day = new Date(now).toISOString().slice(0, 10);
    const sentToday = this.sql<{ n: number }>("SELECT n FROM sent_per_day WHERE day = ?", day)[0]?.n ?? 0;
    const room = Number(this.env.TIPS_PER_DAY) - sentToday;
    if (room <= 0) return;
    const due = this.sql<Row>(`SELECT id, email, name, guide, status, step, guide_at, last_sent_at, failures FROM subscribers
      WHERE status = 'active' AND next_at <= ? ORDER BY next_at LIMIT ?`, now, room);
    const cfg = scheduleConfig(this.env);
    let sent = 0;
    for (const row of due) {
      const unsubscribeUrl = `${this.env.WORKER_URL}/tips/unsubscribe?t=${await signLink(this.env.TIPS_SIGNING_KEY, "u", row.id)}`;
      const reply = replyAddress(this.env.TIPS_REPLY_LOCAL, this.env.TIPS_REPLY_DOMAIN, row.id);
      const ok = await sendEmail(this.env, {
        from: this.env.TIPS_FROM,
        to: [row.email],
        // Replies reach Harris directly, and a copy goes to the reply address, which tells us to stop the tips.
        reply_to: [this.env.QUIZ_TO, reply],
        ...renderTip(row.step, { site: this.env.SITE_URL, name: row.name, guide: row.guide, unsubscribeUrl }),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:${reply}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }, `tip-${row.id}-${row.step}-${row.guide_at}`);
      if (ok) {
        sent++;
        const step = row.step + 1;
        if (step >= TIP_COUNT) {
          this.sql("UPDATE subscribers SET step = ?, status = 'done', next_at = NULL, last_sent_at = ?, ended_at = ?, failures = 0 WHERE id = ?", step, now, now, row.id);
        } else {
          this.sql("UPDATE subscribers SET step = ?, next_at = ?, last_sent_at = ?, failures = 0 WHERE id = ?", step, dueAt(step, row.guide_at, now, now, cfg), now, row.id);
        }
      } else if (row.failures + 1 >= MAX_FAILURES) {
        this.sql("UPDATE subscribers SET status = 'stopped', stop_reason = 'send_failed', next_at = NULL, ended_at = ? WHERE id = ?", now, row.id);
        await sendTelegram(this.env, `Tip emails: gave up on ${row.email} after ${MAX_FAILURES} failed sends of tip ${row.step + 1}. Check Resend.`);
      } else {
        // Try again in an hour (a minute in the test run).
        this.sql("UPDATE subscribers SET failures = failures + 1, next_at = ? WHERE id = ?", now + Math.min(3600_000, cfg.dayMs), row.id);
      }
    }
    if (sent) this.sql("INSERT INTO sent_per_day (day, n) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET n = n + ?", day, sent, sent);
  }

  private cleanUp(now: number): void {
    this.sql("DELETE FROM subscribers WHERE status = 'pending' AND created_at < ?", now - PENDING_DAYS * DAY);
    this.sql("DELETE FROM subscribers WHERE status IN ('done', 'stopped') AND ended_at < ?", now - KEEP_DAYS * DAY);
    this.sql("DELETE FROM sent_per_day WHERE day < ?", new Date(now - 2 * DAY).toISOString().slice(0, 10));
  }

  /** Wakes at the next due tip, or within 6 hours to tidy up, or never if the list is empty. If today's cap is
   *  used up, due tips wait for the next UTC day. */
  private async ensureAlarm(now: number, replace = false): Promise<void> {
    const [{ n }] = this.sql<{ n: number }>("SELECT COUNT(*) AS n FROM subscribers");
    if (!n) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const [{ next }] = this.sql<{ next: number | null }>("SELECT MIN(next_at) AS next FROM subscribers WHERE status = 'active'");
    const day = new Date(now).toISOString().slice(0, 10);
    const capped = (this.sql<{ n: number }>("SELECT n FROM sent_per_day WHERE day = ?", day)[0]?.n ?? 0) >= Number(this.env.TIPS_PER_DAY);
    const tomorrow = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
    let at = now + 6 * 3600_000;
    // Without the Resend key or signing key nothing can be sent, so don't wake up for due tips.
    const ready = !!this.env.RESEND_API_KEY && !!this.env.TIPS_SIGNING_KEY;
    if (next !== null && ready) at = Math.min(at, Math.max(capped ? tomorrow : next, now));
    const current = await this.ctx.storage.getAlarm();
    if (replace || current === null || at < current) await this.ctx.storage.setAlarm(at);
  }

  /** For the test run: everyone on the list and where they are. Only the test Worker exposes it. */
  async debugList(): Promise<Array<Record<string, SqlStorageValue>>> {
    return this.sql("SELECT id, email, status, stop_reason, step, next_at, last_sent_at FROM subscribers ORDER BY created_at");
  }
}
