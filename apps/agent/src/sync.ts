import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "mysql2/promise";
import { aggregateByCid, localDay, startOfLocalDay, type CallRow, type CidCounters } from "./aggregate";
import { resolveCid } from "./cid";
import type { Config } from "./config";
import { fetchCalls, fetchLiveAgents, fetchRecordings } from "./vicidial";

const BATCH = 500;

async function check<T>(label: string, p: PromiseLike<{ error: { message: string } | null; data?: T | null }>) {
  const { error, data } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
}

async function upsertInBatches(db: SupabaseClient, table: string, rows: object[], onConflict: string, ignoreDuplicates = false) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await check(`upsert ${table}`, db.from(table).upsert(rows.slice(i, i + BATCH), { onConflict, ignoreDuplicates }));
  }
}

/** Heartbeat + replace the live agent snapshot. Runs every few seconds. */
export async function syncLive(db: SupabaseClient, pool: Pool, cfg: Config, version: string) {
  const agents = await fetchLiveAgents(pool);
  const now = new Date().toISOString();

  if (agents.length > 0) {
    await upsertInBatches(
      db,
      "agents_live",
      agents.map((a) => ({
        agent_user: a.user,
        full_name: a.fullName,
        status: a.status,
        pause_code: a.pauseCode,
        campaign_id: a.campaignId,
        lead_id: a.leadId,
        calls_today: a.callsToday,
        state_since: a.stateSince?.toISOString() ?? null,
        updated_at: now,
      })),
      "agent_user",
    );
  }

  // Agents that logged out disappear from vicidial_live_agents; remove them from the snapshot.
  const present = agents.map((a) => a.user);
  const del = db.from("agents_live").delete();
  await check(
    "prune agents_live",
    present.length ? del.not("agent_user", "in", `(${present.map((u) => `"${u.replace(/"/g, "")}"`).join(",")})`) : del.neq("agent_user", ""),
  );

  await check(
    "heartbeat",
    db.from("dialers").upsert(
      { name: cfg.dialerName, last_heartbeat_at: now, agent_version: version, status: "online" },
      { onConflict: "name" },
    ),
  );

  return agents.length;
}

type SyncState = { callsCursor: Date | null; lastPurge: number };

/** Per-caller-ID counters, daily rollups and the 7-day call feed. Runs every minute. */
export async function syncStats(db: SupabaseClient, pool: Pool, cfg: Config, state: SyncState) {
  const now = new Date();
  const today = startOfLocalDay(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  const rows = await fetchCalls(pool, yesterday);
  const todayRows = rows.filter((r) => r.callDate >= today);
  const yesterdayRows = rows.filter((r) => r.callDate < today);
  const aggOpts = { now, shortCallSeconds: cfg.shortCallSeconds, cidOverride: cfg.cidOverride };
  const aggToday = aggregateByCid(todayRows, aggOpts);
  const aggYesterday = aggregateByCid(yesterdayRows, aggOpts);

  // Recent call feed rows. First run backfills the retention window; later runs re-read one extra
  // sync interval plus 15 minutes, so calls that were still in progress get their final status/length.
  const windowStart = new Date(now.getTime() - cfg.recentCallDays * 86_400_000);
  const overlapMs = cfg.statsIntervalMs + 15 * 60_000;
  const since = state.callsCursor ? new Date(state.callsCursor.getTime() - overlapMs) : windowStart;
  const feedRows = since >= yesterday ? rows.filter((r) => r.callDate >= since) : await fetchCalls(pool, since);

  // 1. Make sure every caller ID seen on the dialer exists in the pool (NEW, flagged as not imported).
  const seen = new Set([...aggToday.keys(), ...aggYesterday.keys()]);
  for (const r of feedRows) {
    const cid = resolveCid(r.outboundCid, cfg.cidOverride);
    if (cid) seen.add(cid);
  }
  if (seen.size) {
    await upsertInBatches(
      db,
      "dids",
      [...seen].map((e164) => ({ e164, notes: "Seen on dialer, not imported" })),
      "e164",
      true,
    );
  }

  const dids = await check<{ id: string; e164: string }[]>("load dids", db.from("dids").select("id, e164"));
  const idByE164 = new Map(dids.map((d) => [d.e164, d.id]));

  // 2. Live counters for every DID (zeros for numbers with no calls today).
  const updatedAt = now.toISOString();
  await upsertInBatches(
    db,
    "did_stats_live",
    dids.map((d) => {
      const c = aggToday.get(d.e164);
      return {
        did_id: d.id,
        calls_today: c?.calls ?? 0,
        calls_last_hour: c?.callsLastHour ?? 0,
        answered_today: c?.answered ?? 0,
        short_calls_today: c?.shortCalls ?? 0,
        drops_today: c?.drops ?? 0,
        sip_rejects_today: c?.sipRejects ?? 0,
        last_call_at: c?.lastCallAt?.toISOString() ?? null,
        updated_at: updatedAt,
      };
    }),
    "did_id",
  );

  // 3. Daily rollups for today and yesterday (yesterday finalizes after midnight).
  const daily = [
    ...dailyRows(aggToday, localDay(today), idByE164),
    ...dailyRows(aggYesterday, localDay(yesterday), idByE164),
  ];
  if (daily.length) await upsertInBatches(db, "did_stats_daily", daily, "did_id,day");

  // 4. Recent call feed.
  if (feedRows.length) {
    await upsertInBatches(db, "calls_recent", feedRows.map((r) => callFeedRow(r, cfg, idByE164)), "uniqueid");
  }
  // 4b. Attach recordings. They land a few minutes after the call, so re-read the whole
  // feed window rather than only what is new, and update the rows that now have audio.
  const recordings = await fetchRecordings(pool, windowStart);
  let recorded = 0;
  for (const r of recordings) {
    const { error } = await db
      .from("calls_recent")
      .update({ recording_sec: r.lengthSec, recording_file: r.filename, recording_url: r.location })
      .eq("uniqueid", r.uniqueid)
      .is("recording_file", null);
    if (!error) recorded++;
  }

  state.callsCursor = now;

  // 5. Purge the feed hourly.
  if (now.getTime() - state.lastPurge > 3_600_000) {
    await check("purge calls_recent", db.from("calls_recent").delete().lt("call_date", windowStart.toISOString()));
    state.lastPurge = now.getTime();
  }

  return { callsToday: todayRows.length, callerIds: aggToday.size, feed: feedRows.length, recordings: recorded };
}

function dailyRows(agg: Map<string, CidCounters>, day: string, idByE164: Map<string, string>) {
  const out = [];
  for (const [e164, c] of agg) {
    const didId = idByE164.get(e164);
    if (!didId) continue;
    out.push({
      did_id: didId,
      day,
      calls: c.calls,
      answered: c.answered,
      human_answer_rate: c.calls ? round4(c.answered / c.calls) : null,
      short_call_pct: c.answered ? round4(c.shortCalls / c.answered) : null,
      avg_talk_sec: c.answered ? Math.round((c.talkSecTotal / c.answered) * 100) / 100 : null,
      drops: c.drops,
      sip_503: c.sip503,
      sip_603: c.sip603,
      sip_608: c.sip608,
      unique_numbers: c.uniqueNumbers.size,
    });
  }
  return out;
}

function callFeedRow(r: CallRow, cfg: Config, idByE164: Map<string, string>) {
  const cid = resolveCid(r.outboundCid, cfg.cidOverride);
  return {
    uniqueid: r.uniqueid ?? `cc:${r.callerCode}`,
    call_date: r.callDate.toISOString(),
    did_id: cid ? idByE164.get(cid) ?? null : null,
    outbound_cid: cid ?? r.outboundCid,
    lead_phone_last4: r.phoneNumber ? r.phoneNumber.slice(-4) : null,
    campaign_id: r.campaignId,
    agent_user: r.agentUser,
    status: r.status,
    length_sec: r.lengthSec,
    sip_code: r.sipCode ? String(r.sipCode) : null,
    sip_reason: null,
    call_type: r.callType,
  };
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
