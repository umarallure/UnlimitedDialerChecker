import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type DailyStat, type DidRow, evaluateDid, evaluatePool, healthWindow, warmupWeekFor } from "./index";

const NOW = new Date("2026-09-20T12:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function dayString(n: number): string {
  return daysAgo(n).slice(0, 10);
}

const did: DidRow = {
  id: "did-1",
  e164: "+17285003009",
  lifecycle: "NEW",
  lifecycleSince: daysAgo(0),
  warmupWeek: 0,
  manualHold: false,
  dailyCap: 0,
  hourlyCap: 12,
  capOverride: null,
  fcrRegisteredAt: daysAgo(10),
  inboundRouteOk: true,
  latestLabel: "clean",
};

function stat(over: Partial<DailyStat> = {}): DailyStat {
  return { didId: "did-1", day: dayString(1), calls: 50, answered: 10, shortCallPct: 0.1, drops: 0, sip608: 0, ...over };
}

describe("healthWindow", () => {
  it("returns null when there is no data in the window", () => {
    expect(healthWindow([], 3, NOW, false)).toBeNull();
    expect(healthWindow([stat({ day: dayString(30) })], 3, NOW, false)).toBeNull();
  });

  it("weights each day's short-call rate by that day's volume", () => {
    const w = healthWindow([stat({ day: dayString(1), calls: 100, shortCallPct: 0.3 }), stat({ day: dayString(2), calls: 10, shortCallPct: 0 })], 3, NOW, false);
    expect(w?.calls).toBe(110);
    expect(w?.shortCallPct).toBeCloseTo(0.2727, 4);
  });

  it("totals answers, drops and SIP 608s across the window", () => {
    const w = healthWindow([stat({ day: dayString(1), calls: 40, answered: 4, drops: 2, sip608: 1 }), stat({ day: dayString(2), calls: 60, answered: 11, drops: 1, sip608: 3 })], 3, NOW, true);
    expect(w).toMatchObject({ calls: 100, sip608: 4, labeled: true });
    expect(w?.answerRate).toBeCloseTo(0.15, 4);
    expect(w?.dropPct).toBeCloseTo(0.03, 4);
  });
});

describe("warmupWeekFor", () => {
  it("advances a week for every 7 days in WARMING", () => {
    expect(warmupWeekFor({ ...did, lifecycle: "WARMING", lifecycleSince: daysAgo(0) }, NOW)).toBe(1);
    expect(warmupWeekFor({ ...did, lifecycle: "WARMING", lifecycleSince: daysAgo(13) }, NOW)).toBe(2);
    expect(warmupWeekFor({ ...did, lifecycle: "WARMING", lifecycleSince: daysAgo(21) }, NOW)).toBe(4);
  });

  it("leaves the stored week alone outside WARMING", () => {
    expect(warmupWeekFor({ ...did, lifecycle: "ACTIVE", warmupWeek: 3 }, NOW)).toBe(3);
  });
});

describe("evaluateDid", () => {
  it("proposes nothing for a number that is still aging", () => {
    expect(evaluateDid({ ...did, lifecycleSince: daysAgo(3) }, [], DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("starts warm-up once a number is aged and its checks pass", () => {
    const p = evaluateDid({ ...did, lifecycleSince: daysAgo(8) }, [], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "promote", toState: "WARMING", proposedWarmupWeek: 1, proposedCap: 20 });
  });

  it("holds a number back when the callback route or registration is missing", () => {
    expect(evaluateDid({ ...did, lifecycleSince: daysAgo(8), inboundRouteOk: false }, [], DEFAULT_POLICY, NOW)).toBeNull();
    expect(evaluateDid({ ...did, lifecycleSince: daysAgo(8), fcrRegisteredAt: null }, [], DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("never promotes a number that has never been scanned", () => {
    expect(evaluateDid({ ...did, lifecycleSince: daysAgo(8), latestLabel: null }, [], DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("cools a labeled active number and sets its cap to zero", () => {
    const p = evaluateDid({ ...did, lifecycle: "ACTIVE", dailyCap: 60, latestLabel: "spam_likely" }, [stat()], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "cool", toState: "COOLING", proposedCap: 0 });
    expect(p?.reason).toContain("spam label");
  });

  it("cools on a bad answer rate once there are enough calls to judge", () => {
    const thin = evaluateDid({ ...did, lifecycle: "ACTIVE", dailyCap: 60 }, [stat({ calls: 10, answered: 0 })], DEFAULT_POLICY, NOW);
    expect(thin).toBeNull();
    const p = evaluateDid({ ...did, lifecycle: "ACTIVE", dailyCap: 60 }, [stat({ calls: 60, answered: 2 })], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "cool", toState: "COOLING" });
  });

  it("advances the warm-up week without changing state", () => {
    const p = evaluateDid({ ...did, lifecycle: "WARMING", warmupWeek: 1, dailyCap: 20, lifecycleSince: daysAgo(8) }, [stat()], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "warmup", toState: null, proposedWarmupWeek: 2, proposedCap: 40 });
  });

  it("promotes to ACTIVE after the last warm-up week with healthy numbers", () => {
    const p = evaluateDid({ ...did, lifecycle: "WARMING", warmupWeek: 4, dailyCap: 60, lifecycleSince: daysAgo(22) }, [stat({ calls: 60, answered: 9 })], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "promote", toState: "ACTIVE", proposedCap: 60 });
  });

  it("corrects a cap that drifted from the rules", () => {
    const p = evaluateDid({ ...did, lifecycle: "ACTIVE", dailyCap: 200 }, [stat()], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "cap", toState: null, currentCap: 200, proposedCap: 60 });
  });

  it("zeroes the cap of a held number but leaves its state alone", () => {
    const p = evaluateDid({ ...did, lifecycle: "ACTIVE", dailyCap: 60, manualHold: true }, [stat()], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "cap", toState: null, proposedCap: 0 });
  });

  it("respects an operator cap override", () => {
    expect(evaluateDid({ ...did, lifecycle: "ACTIVE", dailyCap: 10, capOverride: 10 }, [stat()], DEFAULT_POLICY, NOW)).toBeNull();
  });

  it("returns a cooled number to warm-up once it is rested and clean", () => {
    const p = evaluateDid({ ...did, lifecycle: "COOLING", lifecycleSince: daysAgo(15), dailyCap: 0 }, [], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "promote", toState: "WARMING", proposedWarmupWeek: 1, proposedCap: 20 });
  });

  it("retires a number still labeled after 30 days of cooling", () => {
    const p = evaluateDid({ ...did, lifecycle: "COOLING", lifecycleSince: daysAgo(31), latestLabel: "blocked" }, [], DEFAULT_POLICY, NOW);
    expect(p).toMatchObject({ kind: "retire", toState: "RETIRED", proposedCap: 0 });
  });
});

describe("evaluatePool", () => {
  it("skips retired numbers and groups stats by number", () => {
    const pool: DidRow[] = [
      { ...did, id: "a", lifecycleSince: daysAgo(8) },
      { ...did, id: "b", lifecycle: "RETIRED" },
      { ...did, id: "c", lifecycle: "ACTIVE", dailyCap: 60 },
    ];
    const stats: DailyStat[] = [stat({ didId: "c", calls: 60, answered: 1 })];
    const out = evaluatePool(pool, stats, DEFAULT_POLICY, NOW);
    expect(out).toMatchObject({ evaluated: 2, skipped: 1 });
    expect(out.proposals.map((p) => [p.didId, p.kind])).toEqual([
      ["a", "promote"],
      ["c", "cool"],
    ]);
  });

  it("returns no proposals for a pool that is already in step with the rules", () => {
    const out = evaluatePool([{ ...did, lifecycleSince: daysAgo(2) }], [], DEFAULT_POLICY, NOW);
    expect(out.proposals).toEqual([]);
  });
});
