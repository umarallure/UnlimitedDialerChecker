import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Call reporting, stored once per campaign, day, hour, agent and outcome.
 *
 * A manager asks things a daily total cannot answer: "this week, mornings only", "how did
 * agent1 do on Tuesday", "how many conversations ran past two minutes". Keeping every call for
 * ever would answer them, but the call feed is deliberately a seven-day window. So the facts are
 * kept at the smallest grain worth storing — the hour — and everything else is a sum over it.
 *
 * Duration counts are stored rather than derived. How many talks passed two minutes cannot be
 * recovered from a sum of seconds, so the buckets are counted on the dialer, where the rows are.
 */

export type CallStatRow = {
  campaignId: string;
  day: string;
  hour: number;
  /** '' when no agent took the call — VICIdial writes VDAD/VDCL for those. */
  agentUser: string;
  status: string;
  calls: number;
  talkSec: number;
  calls60Plus: number;
  calls120Plus: number;
  calls300Plus: number;
};

const CHUNK = 500;

export async function fetchCallStats(pool: Pool, days: number): Promise<CallStatRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT campaign_id, DATE(call_date) AS day, HOUR(call_date) AS hour,
            CASE WHEN user IS NULL OR user IN ('VDAD', 'VDCL', '') THEN '' ELSE user END AS agent_user,
            status,
            COUNT(*) AS calls,
            SUM(COALESCE(length_in_sec, 0)) AS talk_sec,
            SUM(COALESCE(length_in_sec, 0) >= 60) AS calls_60,
            SUM(COALESCE(length_in_sec, 0) >= 120) AS calls_120,
            SUM(COALESCE(length_in_sec, 0) >= 300) AS calls_300
       FROM vicidial_log
      WHERE call_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY campaign_id, DATE(call_date), HOUR(call_date), agent_user, status`,
    [days],
  );

  return rows.map((r) => ({
    campaignId: String(r.campaign_id),
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    hour: Number(r.hour ?? 0),
    agentUser: String(r.agent_user ?? ""),
    status: String(r.status ?? ""),
    calls: Number(r.calls ?? 0),
    talkSec: Number(r.talk_sec ?? 0),
    calls60Plus: Number(r.calls_60 ?? 0),
    calls120Plus: Number(r.calls_120 ?? 0),
    calls300Plus: Number(r.calls_300 ?? 0),
  }));
}

export async function syncCallStats(db: SupabaseClient, pool: Pool, days = 7): Promise<number> {
  const rows = await fetchCallStats(pool, days);
  if (rows.length === 0) return 0;

  // The window is rewritten, not merged. A call's status changes as it goes — a lead that was
  // INCALL an hour ago is a SALE now — and an upsert alone would leave the earlier status
  // sitting there under its own key, counting the same call twice.
  const cutoff = rows.reduce((min, r) => (r.day < min ? r.day : min), rows[0].day);
  const { error: cleared } = await db.from("vici_campaign_call_stats").delete().gte("day", cutoff);
  if (cleared) throw new Error(`clear call stats: ${cleared.message}`);

  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from("vici_campaign_call_stats").upsert(
      rows.slice(i, i + CHUNK).map((r) => ({
        campaign_id: r.campaignId,
        day: r.day,
        hour: r.hour,
        agent_user: r.agentUser,
        status: r.status,
        calls: r.calls,
        talk_sec: r.talkSec,
        calls_60_plus: r.calls60Plus,
        calls_120_plus: r.calls120Plus,
        calls_300_plus: r.calls300Plus,
        updated_at: now,
      })),
      { onConflict: "campaign_id,day,hour,agent_user,status" },
    );
    if (error) throw new Error(`sync call stats: ${error.message}`);
  }
  return rows.length;
}

/**
 * The names behind the codes, so a report can say "Interested — callback booked" rather than
 * "CALLBK". Campaign statuses belong to one campaign; system statuses are shared by all of them
 * and are stored under campaign_id '-', which is what VICIdial itself uses for them.
 */
export async function syncCampaignStatuses(db: SupabaseClient, pool: Pool): Promise<number> {
  const [campaignRows] = await pool.query<RowDataPacket[]>(
    `SELECT campaign_id, status, status_name, selectable, human_answered, sale, dnc,
            not_interested, unworkable, scheduled_callback
       FROM vicidial_campaign_statuses`,
  );
  const [systemRows] = await pool.query<RowDataPacket[]>(
    `SELECT '-' AS campaign_id, status, status_name, selectable, human_answered, sale, dnc,
            not_interested, unworkable, scheduled_callback
       FROM vicidial_statuses`,
  );

  const all = [...campaignRows, ...systemRows];
  if (all.length === 0) return 0;

  const now = new Date().toISOString();
  const { error } = await db.from("vici_campaign_statuses").upsert(
    all.map((r) => ({
      campaign_id: String(r.campaign_id),
      status: String(r.status),
      status_name: r.status_name ?? null,
      selectable: r.selectable === "Y",
      human_answered: r.human_answered === "Y",
      sale: r.sale === "Y",
      dnc: r.dnc === "Y",
      not_interested: r.not_interested === "Y",
      unworkable: r.unworkable === "Y",
      scheduled_callback: r.scheduled_callback === "Y",
      synced_at: now,
    })),
    { onConflict: "campaign_id,status" },
  );
  if (error) throw new Error(`sync campaign statuses: ${error.message}`);
  return all.length;
}
