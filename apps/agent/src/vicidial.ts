import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import type { CallRow } from "./aggregate";
import type { Config } from "./config";

export function createPool(cfg: Config["mysql"]): Pool {
  return mysql.createPool({
    ...cfg,
    connectionLimit: 2,
    // VICIdial stores DATETIME in the server's local zone; the agent runs on that server with TZ set.
    timezone: "local",
    dateStrings: false,
  });
}

export type LiveAgent = {
  user: string;
  fullName: string | null;
  status: string;
  pauseCode: string | null;
  campaignId: string | null;
  leadId: number | null;
  callsToday: number | null;
  stateSince: Date | null;
};

export async function fetchLiveAgents(pool: Pool): Promise<LiveAgent[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT la.user, u.full_name, la.status, la.pause_code, la.campaign_id, la.lead_id, la.calls_today, la.last_state_change
       FROM vicidial_live_agents la
       LEFT JOIN vicidial_users u ON u.user = la.user`,
  );
  return rows.map((r) => ({
    user: String(r.user),
    fullName: r.full_name ?? null,
    status: String(r.status),
    pauseCode: r.pause_code || null,
    campaignId: r.campaign_id || null,
    leadId: r.lead_id ? Number(r.lead_id) : null,
    callsToday: r.calls_today ?? null,
    stateSince: r.last_state_change instanceof Date && !Number.isNaN(r.last_state_change.getTime()) ? r.last_state_change : null,
  }));
}

/**
 * Every outbound dial since `since`, one row per dial attempt.
 * vicidial_dial_cid_log records the caller ID VICIdial chose; the other joins add the outcome.
 */
export async function fetchCalls(pool: Pool, since: Date): Promise<CallRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.caller_code, c.call_date, c.outbound_cid, c.call_type,
            e.uniqueid, l.status, l.length_in_sec, l.user, l.campaign_id, l.phone_number,
            d.sip_hangup_cause,
            COALESCE(cs.human_answered, s.human_answered, 'N') AS human_answered
       FROM vicidial_dial_cid_log c
       LEFT JOIN vicidial_log_extended e ON e.caller_code = c.caller_code
       LEFT JOIN vicidial_log l ON l.uniqueid = e.uniqueid
       LEFT JOIN vicidial_dial_log d ON d.caller_code = c.caller_code
       LEFT JOIN vicidial_statuses s ON s.status = l.status
       LEFT JOIN vicidial_campaign_statuses cs ON cs.status = l.status AND cs.campaign_id = l.campaign_id
      WHERE c.call_date >= ?
      ORDER BY c.call_date`,
    [since],
  );

  // A caller_code can join to more than one log row (e.g. transfers); keep the first per dial attempt.
  const seen = new Set<string>();
  const out: CallRow[] = [];
  for (const r of rows) {
    const key = `${r.caller_code}|${(r.call_date as Date).getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sip = Number(r.sip_hangup_cause);
    out.push({
      callerCode: String(r.caller_code),
      callDate: r.call_date as Date,
      outboundCid: r.outbound_cid ?? null,
      uniqueid: r.uniqueid ?? null,
      status: r.status ?? null,
      lengthSec: r.length_in_sec === null || r.length_in_sec === undefined ? null : Number(r.length_in_sec),
      agentUser: r.user || null,
      campaignId: r.campaign_id || null,
      phoneNumber: r.phone_number || null,
      callType: r.call_type || null,
      sipCode: Number.isFinite(sip) && sip > 0 ? sip : null,
      humanAnswered: r.human_answered === "Y",
    });
  }
  return out;
}

export type RecordingRow = {
  uniqueid: string;
  lengthSec: number | null;
  filename: string | null;
  location: string | null;
};

/**
 * Recording metadata for calls since `since`. `vicidial_id` is the call's uniqueid, so this
 * joins straight onto the call feed. Only metadata is read — the audio stays on the dialer.
 * A recording appears here a few minutes after the call, once the compress cron has run.
 */
export async function fetchRecordings(pool: Pool, since: Date): Promise<RecordingRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT vicidial_id, length_in_sec, filename, location
       FROM recording_log
      WHERE start_time >= ? AND vicidial_id IS NOT NULL AND vicidial_id != ''`,
    [since],
  );
  return rows.map((r) => ({
    uniqueid: String(r.vicidial_id),
    lengthSec: r.length_in_sec === null || r.length_in_sec === undefined ? null : Number(r.length_in_sec),
    filename: r.filename || null,
    location: r.location || null,
  }));
}
