/**
 * Pure DID lifecycle rules shared by the web app (dry-run previews, settings)
 * and the dialer agent (enforcement). No I/O here, so it is fully unit-testable.
 * Defaults mirror the seeded row in supabase/migrations/*_p0_foundation.sql.
 */

export type Lifecycle = "NEW" | "WARMING" | "ACTIVE" | "COOLING" | "RETIRED";

export type PolicySettings = {
  agingDays: number;
  warmupDailyCaps: number[];
  activeDailyCap: number;
  hourlyCap: number;
  promote: { minAnswerRate: number; maxShortCallPct: number; maxDropPct: number };
  hardCool: { minAnswerRate3d: number; maxShortCallPct: number; maxDropPct: number; sip608Spike: number };
  softCool: { answerRateDropPts: number; shortCallPctFrom: number };
  coolingDays: number;
  reentryDailyCap: number;
  /** Gate warm-up on a clean reputation scan. Turn off while no reputation provider is connected. */
  requireCleanReputation: boolean;
  retireIfLabeledAtDay: number;
};

export const DEFAULT_POLICY: PolicySettings = {
  agingDays: 7,
  warmupDailyCaps: [20, 40, 60],
  activeDailyCap: 60,
  hourlyCap: 12,
  promote: { minAnswerRate: 0.1, maxShortCallPct: 0.2, maxDropPct: 0.03 },
  hardCool: { minAnswerRate3d: 0.08, maxShortCallPct: 0.3, maxDropPct: 0.03, sip608Spike: 5 },
  softCool: { answerRateDropPts: 0.05, shortCallPctFrom: 0.2 },
  coolingDays: 14,
  reentryDailyCap: 25,
  requireCleanReputation: true,
  retireIfLabeledAtDay: 30,
};

export type DidSnapshot = {
  lifecycle: Lifecycle;
  daysInState: number;
  warmupWeek: number; // 1-based while WARMING
  manualHold: boolean;
  fcrRegistered: boolean;
  inboundRouteOk: boolean;
  latestLabelClean: boolean | null; // null = never checked
};

export type HealthWindow = {
  calls: number;
  answerRate: number; // 0..1
  shortCallPct: number; // 0..1
  dropPct: number; // 0..1
  sip608: number;
  answerRatePrevWeek?: number;
  labeled: boolean;
};

/** Daily cap VICIdial may use for this DID today. 0 means it must be inactive. */
export function dailyCap(did: DidSnapshot, p: PolicySettings = DEFAULT_POLICY): number {
  if (did.manualHold) return 0;
  switch (did.lifecycle) {
    case "WARMING": {
      const idx = Math.min(Math.max(did.warmupWeek, 1), p.warmupDailyCaps.length) - 1;
      return p.warmupDailyCaps[idx];
    }
    case "ACTIVE":
      return p.activeDailyCap;
    default:
      return 0;
  }
}

/** Whether the DID should be `active='Y'` in VICIdial right now. */
export function shouldDial(
  did: DidSnapshot,
  usage: { callsToday: number; callsLastHour: number },
  p: PolicySettings = DEFAULT_POLICY,
): boolean {
  const cap = dailyCap(did, p);
  return cap > 0 && usage.callsToday < cap && usage.callsLastHour < p.hourlyCap;
}

export type Transition = { to: Lifecycle; reason: string } | null;

/** Next lifecycle state, or null to stay. Hard triggers win over promotions. */
export function nextTransition(did: DidSnapshot, h: HealthWindow | null, p: PolicySettings = DEFAULT_POLICY): Transition {
  if (did.lifecycle === "RETIRED") return null;

  if (did.lifecycle === "WARMING" || did.lifecycle === "ACTIVE") {
    if (h?.labeled) return { to: "COOLING", reason: "spam label detected" };
    if (h && h.calls >= 20) {
      if (h.answerRate < p.hardCool.minAnswerRate3d) return { to: "COOLING", reason: `answer rate ${pct(h.answerRate)} below ${pct(p.hardCool.minAnswerRate3d)}` };
      if (h.shortCallPct > p.hardCool.maxShortCallPct) return { to: "COOLING", reason: `short calls ${pct(h.shortCallPct)} above ${pct(p.hardCool.maxShortCallPct)}` };
      if (h.dropPct > p.hardCool.maxDropPct) return { to: "COOLING", reason: `drops ${pct(h.dropPct)} above ${pct(p.hardCool.maxDropPct)}` };
    }
    if (h && h.sip608 >= p.hardCool.sip608Spike) return { to: "COOLING", reason: `${h.sip608} SIP 608 rejects` };
  }

  switch (did.lifecycle) {
    case "NEW":
      if (did.daysInState >= p.agingDays && did.fcrRegistered && did.inboundRouteOk && reputationOk(did, p)) {
        const how = p.requireCleanReputation ? "reputation verified" : "reputation checks off";
        return { to: "WARMING", reason: `aged, registered, callback route and ${how}` };
      }
      return null;
    case "WARMING":
      if (
        did.warmupWeek > p.warmupDailyCaps.length &&
        h &&
        h.answerRate >= p.promote.minAnswerRate &&
        h.shortCallPct <= p.promote.maxShortCallPct &&
        h.dropPct <= p.promote.maxDropPct
      ) {
        return { to: "ACTIVE", reason: "warm-up complete with healthy metrics" };
      }
      return null;
    case "COOLING":
      if (did.daysInState >= p.retireIfLabeledAtDay && did.latestLabelClean === false) {
        return { to: "RETIRED", reason: `still labeled after ${p.retireIfLabeledAtDay} days` };
      }
      if (did.daysInState >= p.coolingDays && reputationOk(did, p)) {
        return { to: "WARMING", reason: p.requireCleanReputation ? "cool-off complete and reputation clean" : "cool-off complete, reputation checks off" };
      }
      return null;
    default:
      return null;
  }
}

/**
 * May this number move towards dialing, reputation-wise?
 * With checks required, only a clean scan passes. With checks off — no provider connected —
 * a number that has never been scanned may proceed, but a known bad label still blocks it.
 */
function reputationOk(did: DidSnapshot, p: PolicySettings): boolean {
  return p.requireCleanReputation ? did.latestLabelClean === true : did.latestLabelClean !== false;
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

export * from "./evaluate";

export * from "./dialing";
