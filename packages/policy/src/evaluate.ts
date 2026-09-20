/**
 * Pool evaluation: turns rows from Supabase into the changes the lifecycle engine
 * would make. Pure and deterministic — `now` is always passed in — so the web app
 * (dry-run preview) and the dialer agent (scheduled run, enforcement) share one
 * implementation and one set of tests.
 */

import { DEFAULT_POLICY, type HealthWindow, type Lifecycle, type PolicySettings, dailyCap, nextTransition } from "./index";

export type DidRow = {
  id: string;
  e164: string;
  lifecycle: Lifecycle;
  lifecycleSince: string;
  warmupWeek: number;
  manualHold: boolean;
  dailyCap: number;
  hourlyCap: number;
  capOverride: number | null;
  fcrRegisteredAt: string | null;
  inboundRouteOk: boolean;
  /** Most recent reputation label, or null when the number has never been scanned. */
  latestLabel: string | null;
};

export type DailyStat = {
  didId: string;
  day: string; // YYYY-MM-DD
  calls: number;
  answered: number;
  shortCallPct: number | null;
  drops: number;
  sip608: number;
};

export type ProposalKind = "promote" | "cool" | "retire" | "warmup" | "cap";

export type Proposal = {
  didId: string;
  e164: string;
  kind: ProposalKind;
  fromState: Lifecycle;
  toState: Lifecycle | null;
  warmupWeek: number;
  proposedWarmupWeek: number;
  currentCap: number;
  proposedCap: number;
  reason: string;
  metrics: HealthWindow | null;
};

export type PoolEvaluation = { evaluated: number; skipped: number; proposals: Proposal[] };

/** Labels that mean a carrier or app is flagging the number. */
const DIRTY_LABELS = new Set(["spam_likely", "scam_likely", "blocked"]);

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / DAY_MS));
}

/** Warm-up week derived from time in state, so a number advances 20 → 40 → 60 on its own. */
export function warmupWeekFor(did: DidRow, now: Date): number {
  if (did.lifecycle !== "WARMING") return did.warmupWeek;
  return Math.floor(daysBetween(did.lifecycleSince, now) / 7) + 1;
}

/**
 * Aggregate the last `days` daily rows into one health window.
 * Returns null when there is no data at all — the rules treat that as "cannot judge yet".
 */
export function healthWindow(rows: DailyStat[], days: number, now: Date, labeled: boolean): HealthWindow | null {
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const recent = rows.filter((r) => r.day >= cutoff);
  if (recent.length === 0) return null;

  const calls = recent.reduce((n, r) => n + r.calls, 0);
  const answered = recent.reduce((n, r) => n + r.answered, 0);
  const drops = recent.reduce((n, r) => n + r.drops, 0);
  const sip608 = recent.reduce((n, r) => n + r.sip608, 0);
  // short_call_pct is stored per day, so weight each day by its call volume.
  const shortCalls = recent.reduce((n, r) => n + (r.shortCallPct ?? 0) * r.calls, 0);

  return {
    calls,
    answerRate: calls > 0 ? answered / calls : 0,
    shortCallPct: calls > 0 ? shortCalls / calls : 0,
    dropPct: calls > 0 ? drops / calls : 0,
    sip608,
    labeled,
  };
}

function kindOf(to: Lifecycle): ProposalKind {
  if (to === "RETIRED") return "retire";
  if (to === "COOLING") return "cool";
  return "promote";
}

/**
 * Evaluate one number. Returns the single change to make, or null when nothing is due.
 * A state transition wins over a cap or warm-up-week change, because the transition
 * sets the cap anyway.
 */
export function evaluateDid(did: DidRow, stats: DailyStat[], p: PolicySettings = DEFAULT_POLICY, now = new Date()): Proposal | null {
  const labeled = did.latestLabel !== null && DIRTY_LABELS.has(did.latestLabel);
  const health = healthWindow(stats, 3, now, labeled);
  const warmupWeek = warmupWeekFor(did, now);

  const snapshot = {
    lifecycle: did.lifecycle,
    daysInState: daysBetween(did.lifecycleSince, now),
    warmupWeek,
    manualHold: did.manualHold,
    fcrRegistered: did.fcrRegisteredAt !== null,
    inboundRouteOk: did.inboundRouteOk,
    latestLabelClean: did.latestLabel === null ? null : !DIRTY_LABELS.has(did.latestLabel),
  };

  const base = {
    didId: did.id,
    e164: did.e164,
    fromState: did.lifecycle,
    warmupWeek: did.warmupWeek,
    proposedWarmupWeek: warmupWeek,
    currentCap: did.dailyCap,
    metrics: health,
  };

  const transition = nextTransition(snapshot, health, p);
  if (transition) {
    const to = transition.to;
    // A number entering WARMING starts its warm-up again, including one re-entering from
    // COOLING. Caps always come from dailyCap(), the same function the agent enforces with,
    // so a preview can never promise a cap the dialer would not apply.
    const proposedWarmupWeek = to === "WARMING" ? 1 : 0;
    const proposedCap = dailyCap({ ...snapshot, lifecycle: to, warmupWeek: proposedWarmupWeek || 1 }, p);
    return { ...base, kind: kindOf(to), toState: to, proposedWarmupWeek, proposedCap, reason: transition.reason };
  }

  // No transition due. Keep the warm-up week and the cap in step with the rules.
  if (did.lifecycle === "WARMING" && warmupWeek !== did.warmupWeek && warmupWeek <= p.warmupDailyCaps.length) {
    return {
      ...base,
      kind: "warmup",
      toState: null,
      proposedCap: dailyCap({ ...snapshot, warmupWeek }, p),
      reason: `warm-up week ${warmupWeek} of ${p.warmupDailyCaps.length}`,
    };
  }

  // An operator cap override is deliberate, so the engine leaves it alone.
  if (did.capOverride === null) {
    const proposedCap = dailyCap(snapshot, p);
    if (proposedCap !== did.dailyCap) {
      return { ...base, kind: "cap", toState: null, proposedCap, reason: did.manualHold ? "on hold, cap must be 0" : `cap should be ${proposedCap} in ${did.lifecycle}` };
    }
  }

  return null;
}

/** Evaluate the whole pool. Retired numbers are skipped; they are out of rotation for good. */
export function evaluatePool(
  dids: DidRow[],
  stats: DailyStat[],
  p: PolicySettings = DEFAULT_POLICY,
  now = new Date(),
): PoolEvaluation {
  const byDid = new Map<string, DailyStat[]>();
  for (const s of stats) {
    const list = byDid.get(s.didId);
    if (list) list.push(s);
    else byDid.set(s.didId, [s]);
  }

  const proposals: Proposal[] = [];
  let evaluated = 0;
  let skipped = 0;

  for (const did of dids) {
    if (did.lifecycle === "RETIRED") {
      skipped++;
      continue;
    }
    evaluated++;
    const proposal = evaluateDid(did, byDid.get(did.id) ?? [], p, now);
    if (proposal) proposals.push(proposal);
  }

  return { evaluated, skipped, proposals };
}
