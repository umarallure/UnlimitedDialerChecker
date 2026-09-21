import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  DEFAULT_POLICY,
  type DailyStat,
  type DidRow,
  type PolicySettings,
  type Proposal,
  dailyCap,
  evaluatePool,
  warmupWeekFor,
} from "@udc/policy";
import type { Config } from "./config";

/**
 * The lifecycle engine, run on a schedule by the agent.
 *
 * In `dry_run` it only records what it would do. In `enforce` it applies each proposal
 * to the pool and then makes VICIdial match: one row per caller ID in the campaign's
 * CID group, with `active` set from the number's lifecycle and today's usage.
 *
 * The rules themselves live in @udc/policy and are shared with the web preview, so the
 * dialer can never act on rules the Rotation page did not show.
 */

const STATS_DAYS = 7;
const DIRTY = new Set(["spam_likely", "scam_likely", "blocked"]);

export type RotationResult = { mode: "dry_run" | "enforce"; evaluated: number; proposals: number; applied: number; cidRows: number };

function dayCutoff(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function policyFrom(settings: unknown): PolicySettings {
  const s = (settings ?? {}) as Partial<PolicySettings>;
  return {
    ...DEFAULT_POLICY,
    ...s,
    promote: { ...DEFAULT_POLICY.promote, ...s.promote },
    hardCool: { ...DEFAULT_POLICY.hardCool, ...s.hardCool },
    softCool: { ...DEFAULT_POLICY.softCool, ...s.softCool },
  };
}

export type PoolSnapshot = { dids: DidRow[]; stats: DailyStat[]; policy: PolicySettings; mode: "dry_run" | "enforce" };

/** Everything the engine needs, read from Supabase in one go. */
export async function loadPool(db: SupabaseClient, now: Date): Promise<PoolSnapshot> {
  const [policyRes, didRes, statRes, labelRes] = await Promise.all([
    db.from("vici_policies").select("settings, enforcement_mode").eq("is_active", true).maybeSingle(),
    db.from("vici_dids").select("id, e164, lifecycle, lifecycle_since, warmup_week, manual_hold, daily_cap, hourly_cap, cap_override, fcr_registered_at, inbound_route_ok"),
    db.from("vici_did_stats_daily").select("did_id, day, calls, answered, short_call_pct, drops, sip_608").gte("day", dayCutoff(STATS_DAYS, now)),
    db.from("vici_reputation_checks").select("did_id, label, checked_at").order("checked_at", { ascending: false }),
  ]);
  if (didRes.error) throw new Error(`load dids: ${didRes.error.message}`);

  const latestLabel = new Map<string, string>();
  for (const r of labelRes.data ?? []) if (!latestLabel.has(r.did_id)) latestLabel.set(r.did_id, r.label);

  return {
    mode: policyRes.data?.enforcement_mode === "enforce" ? "enforce" : "dry_run",
    policy: policyFrom(policyRes.data?.settings),
    dids: (didRes.data ?? []).map((d) => ({
      id: d.id,
      e164: d.e164,
      lifecycle: d.lifecycle,
      lifecycleSince: d.lifecycle_since,
      warmupWeek: d.warmup_week,
      manualHold: d.manual_hold,
      dailyCap: d.daily_cap,
      hourlyCap: d.hourly_cap,
      capOverride: d.cap_override,
      fcrRegisteredAt: d.fcr_registered_at,
      inboundRouteOk: d.inbound_route_ok,
      latestLabel: latestLabel.get(d.id) ?? null,
    })),
    stats: (statRes.data ?? []).map((s) => ({
      didId: s.did_id,
      day: s.day,
      calls: s.calls,
      answered: s.answered,
      shortCallPct: s.short_call_pct === null ? null : Number(s.short_call_pct),
      drops: s.drops,
      sip608: s.sip_608,
    })),
  };
}

export type CidEntry = { areacode: string; cid: string; active: "Y" | "N"; description: string };

/**
 * The caller-ID rows VICIdial should hold, given the pool and today's usage.
 * A number dials only while it has a cap left for the day and an hour's headroom.
 * Pure, so the Y/N decision is unit-tested rather than discovered in production.
 */
export function cidEntriesFor(
  dids: DidRow[],
  usage: Map<string, { callsToday: number; callsLastHour: number }>,
  policy: PolicySettings,
  now: Date,
): CidEntry[] {
  const out: CidEntry[] = [];
  for (const d of dids) {
    if (d.lifecycle === "RETIRED") continue;
    const snapshot = {
      lifecycle: d.lifecycle,
      daysInState: 0,
      warmupWeek: warmupWeekFor(d, now),
      manualHold: d.manualHold,
      fcrRegistered: d.fcrRegisteredAt !== null,
      inboundRouteOk: d.inboundRouteOk,
      latestLabelClean: d.latestLabel === null ? null : !DIRTY.has(d.latestLabel),
    };
    const cap = d.capOverride ?? dailyCap(snapshot, policy);
    const u = usage.get(d.id) ?? { callsToday: 0, callsLastHour: 0 };
    const active = cap > 0 && u.callsToday < cap && u.callsLastHour < policy.hourlyCap ? "Y" : "N";
    const digits = d.e164.replace(/^\+1/, "");
    out.push({ areacode: digits.slice(0, 3), cid: digits, active, description: `${d.lifecycle} cap ${cap}` });
  }
  return out;
}

/**
 * Make the CID group match `entries`. Rows are keyed by (campaign_id, areacode, outbound_cid),
 * where campaign_id holds the CID group id — that is how VICIdial stores group entries.
 * Numbers the engine no longer manages are switched off rather than deleted, so an operator
 * can still see them in the VICIdial admin.
 */
export async function applyCidEntries(pool: Pool, cidGroupId: string, entries: CidEntry[]): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<RowDataPacket[]>("SELECT areacode, outbound_cid, active FROM vicidial_campaign_cid_areacodes WHERE campaign_id = ?", [cidGroupId]);
    const wanted = new Map(entries.map((e) => [e.cid, e]));
    let changed = 0;

    for (const row of existing) {
      const cid = String(row.outbound_cid ?? "");
      const want = wanted.get(cid);
      if (!want) {
        if (row.active !== "N") {
          await conn.execute("UPDATE vicidial_campaign_cid_areacodes SET active = 'N' WHERE campaign_id = ? AND outbound_cid = ?", [cidGroupId, cid]);
          changed++;
        }
        continue;
      }
      if (row.active !== want.active) {
        await conn.execute("UPDATE vicidial_campaign_cid_areacodes SET active = ?, cid_description = ? WHERE campaign_id = ? AND outbound_cid = ?", [
          want.active,
          want.description,
          cidGroupId,
          cid,
        ]);
        changed++;
      }
      wanted.delete(cid);
    }

    for (const e of wanted.values()) {
      await conn.execute(
        "INSERT INTO vicidial_campaign_cid_areacodes (campaign_id, areacode, outbound_cid, active, cid_description) VALUES (?, ?, ?, ?, ?)",
        [cidGroupId, e.areacode, e.cid, e.active, e.description],
      );
      changed++;
    }

    await conn.commit();
    return changed;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Apply one proposal to the pool and record it in the lifecycle audit trail. */
async function applyProposal(db: SupabaseClient, p: Proposal, now: Date): Promise<void> {
  const patch: Record<string, unknown> = { daily_cap: p.proposedCap, warmup_week: p.proposedWarmupWeek };
  if (p.toState) {
    patch.lifecycle = p.toState;
    patch.lifecycle_since = now.toISOString();
  }
  const { error } = await db.from("vici_dids").update(patch).eq("id", p.didId);
  if (error) throw new Error(`apply ${p.e164}: ${error.message}`);

  if (p.toState) {
    await db.from("vici_did_state_events").insert({
      did_id: p.didId,
      from_state: p.fromState,
      to_state: p.toState,
      reason: p.reason,
      actor: "engine",
      dry_run: false,
      metrics: p.metrics,
    });
  }
}

/**
 * One pass of the engine. Always records a run and its proposals; only applies them
 * when the active policy says `enforce`.
 */
export async function runRotation(db: SupabaseClient, pool: Pool, cfg: Config, now = new Date()): Promise<RotationResult> {
  const snapshot = await loadPool(db, now);
  const { evaluated, skipped, proposals } = evaluatePool(snapshot.dids, snapshot.stats, snapshot.policy, now);
  const enforcing = snapshot.mode === "enforce";

  const { data: run, error: runError } = await db
    .from("vici_lifecycle_runs")
    .insert({ mode: snapshot.mode, triggered_by: `agent:${cfg.dialerName}`, started_at: now.toISOString() })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`start run: ${runError?.message ?? "no run row"}`);

  const fail = async (message: string) => {
    await db.from("vici_lifecycle_runs").update({ error: message, finished_at: new Date().toISOString() }).eq("id", run.id);
    throw new Error(message);
  };

  if (proposals.length) {
    const { error } = await db.from("vici_lifecycle_proposals").insert(
      proposals.map((p) => ({
        run_id: run.id,
        did_id: p.didId,
        kind: p.kind,
        from_state: p.fromState,
        to_state: p.toState,
        warmup_week: p.warmupWeek,
        proposed_warmup_week: p.proposedWarmupWeek,
        current_cap: p.currentCap,
        proposed_cap: p.proposedCap,
        reason: p.reason,
        metrics: p.metrics,
        applied: enforcing,
      })),
    );
    if (error) await fail(`record proposals: ${error.message}`);
  }

  let applied = 0;
  let cidRows = 0;

  if (enforcing) {
    try {
      for (const p of proposals) {
        await applyProposal(db, p, now);
        applied++;
      }

      if (cfg.cidGroupId) {
        // Re-read the pool so the CID rows reflect the transitions just applied.
        const after = applied ? await loadPool(db, now) : snapshot;
        const { data: live } = await db.from("vici_did_stats_live").select("did_id, calls_today, calls_last_hour");
        const usage = new Map((live ?? []).map((l) => [l.did_id, { callsToday: l.calls_today ?? 0, callsLastHour: l.calls_last_hour ?? 0 }]));
        cidRows = await applyCidEntries(pool, cfg.cidGroupId, cidEntriesFor(after.dids, usage, after.policy, now));
      }
    } catch (err) {
      await fail(err instanceof Error ? err.message : String(err));
    }
  }

  await db
    .from("vici_lifecycle_runs")
    .update({ dids_evaluated: evaluated, dids_skipped: skipped, proposals: proposals.length, applied, finished_at: new Date().toISOString() })
    .eq("id", run.id);

  return { mode: snapshot.mode, evaluated, proposals: proposals.length, applied, cidRows };
}
