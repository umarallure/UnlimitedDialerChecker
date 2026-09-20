import "server-only";
import { DEFAULT_POLICY, type DailyStat, type DidRow, type PolicySettings, type Proposal, type ProposalKind, evaluatePool } from "@udc/policy";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Runs the lifecycle engine over the pool and records what it would do.
 * Nothing is applied here: a preview is always written as a `dry_run` run, whatever
 * the active enforcement mode is. Applying proposals is the dialer agent's job.
 */

export const KIND_LABEL: Record<ProposalKind, string> = {
  promote: "Move forward",
  cool: "Cool off",
  retire: "Retire",
  warmup: "Warm-up step",
  cap: "Cap correction",
};

export const KIND_TONE: Record<ProposalKind, "success" | "warning" | "error" | "neutral"> = {
  promote: "success",
  cool: "warning",
  retire: "error",
  warmup: "neutral",
  cap: "neutral",
};

const STATS_DAYS = 7;

type PolicyRow = { settings: unknown; enforcement_mode: "dry_run" | "enforce" };

/** Policy settings from the DB, falling back to the shipped defaults for anything missing. */
export function policyFrom(row: Pick<PolicyRow, "settings"> | null): PolicySettings {
  const s = (row?.settings ?? {}) as Partial<PolicySettings>;
  return { ...DEFAULT_POLICY, ...s, promote: { ...DEFAULT_POLICY.promote, ...s.promote }, hardCool: { ...DEFAULT_POLICY.hardCool, ...s.hardCool }, softCool: { ...DEFAULT_POLICY.softCool, ...s.softCool } };
}

function dayCutoff(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export type PreviewResult = { runId: string; evaluated: number; skipped: number; proposals: Proposal[] };

export async function runPreview(supabase: SupabaseClient, triggeredBy: string, now = new Date()): Promise<PreviewResult> {
  const [{ data: policyRow }, { data: didRows, error: didError }, { data: statRows }, { data: labelRows }] = await Promise.all([
    supabase.from("policies").select("settings, enforcement_mode").eq("is_active", true).maybeSingle(),
    supabase.from("dids").select("id, e164, lifecycle, lifecycle_since, warmup_week, manual_hold, daily_cap, hourly_cap, cap_override, fcr_registered_at, inbound_route_ok"),
    supabase.from("did_stats_daily").select("did_id, day, calls, answered, short_call_pct, drops, sip_608").gte("day", dayCutoff(STATS_DAYS, now)),
    supabase.from("reputation_checks").select("did_id, label, checked_at").order("checked_at", { ascending: false }),
  ]);

  if (didError) throw new Error(didError.message);

  // First row per DID wins: the query is already newest-first.
  const latestLabel = new Map<string, string>();
  for (const r of labelRows ?? []) if (!latestLabel.has(r.did_id)) latestLabel.set(r.did_id, r.label);

  const dids: DidRow[] = (didRows ?? []).map((d) => ({
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
  }));

  const stats: DailyStat[] = (statRows ?? []).map((s) => ({
    didId: s.did_id,
    day: s.day,
    calls: s.calls,
    answered: s.answered,
    shortCallPct: s.short_call_pct === null ? null : Number(s.short_call_pct),
    drops: s.drops,
    sip608: s.sip_608,
  }));

  const { evaluated, skipped, proposals } = evaluatePool(dids, stats, policyFrom(policyRow), now);

  const { data: run, error: runError } = await supabase
    .from("lifecycle_runs")
    .insert({ mode: "dry_run", triggered_by: triggeredBy, started_at: now.toISOString() })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message ?? "Could not start a run");

  if (proposals.length) {
    const { error } = await supabase.from("lifecycle_proposals").insert(
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
      })),
    );
    if (error) {
      await supabase.from("lifecycle_runs").update({ error: error.message, finished_at: new Date().toISOString() }).eq("id", run.id);
      throw new Error(error.message);
    }
  }

  await supabase
    .from("lifecycle_runs")
    .update({ dids_evaluated: evaluated, dids_skipped: skipped, proposals: proposals.length, finished_at: new Date().toISOString() })
    .eq("id", run.id);

  return { runId: run.id, evaluated, skipped, proposals };
}
