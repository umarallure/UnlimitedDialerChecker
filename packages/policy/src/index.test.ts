import { describe, expect, it } from "vitest";
import { dailyCap, nextTransition, shouldDial, type DidSnapshot, type HealthWindow } from "./index";

const base: DidSnapshot = {
  lifecycle: "NEW",
  daysInState: 0,
  warmupWeek: 0,
  manualHold: false,
  fcrRegistered: true,
  inboundRouteOk: true,
  latestLabelClean: true,
};

const healthy: HealthWindow = { calls: 100, answerRate: 0.15, shortCallPct: 0.1, dropPct: 0.01, sip608: 0, labeled: false };

describe("dailyCap", () => {
  it("is zero for NEW, COOLING, RETIRED and held numbers", () => {
    expect(dailyCap({ ...base, lifecycle: "NEW" })).toBe(0);
    expect(dailyCap({ ...base, lifecycle: "COOLING" })).toBe(0);
    expect(dailyCap({ ...base, lifecycle: "RETIRED" })).toBe(0);
    expect(dailyCap({ ...base, lifecycle: "ACTIVE", manualHold: true })).toBe(0);
  });

  it("ramps 20 → 40 → 60 during warm-up and caps ACTIVE at 60", () => {
    expect(dailyCap({ ...base, lifecycle: "WARMING", warmupWeek: 1 })).toBe(20);
    expect(dailyCap({ ...base, lifecycle: "WARMING", warmupWeek: 2 })).toBe(40);
    expect(dailyCap({ ...base, lifecycle: "WARMING", warmupWeek: 3 })).toBe(60);
    expect(dailyCap({ ...base, lifecycle: "ACTIVE" })).toBe(60);
  });
});

describe("shouldDial", () => {
  const active = { ...base, lifecycle: "ACTIVE" as const };
  it("stops at the daily cap and the hourly cap", () => {
    expect(shouldDial(active, { callsToday: 59, callsLastHour: 5 })).toBe(true);
    expect(shouldDial(active, { callsToday: 60, callsLastHour: 5 })).toBe(false);
    expect(shouldDial(active, { callsToday: 10, callsLastHour: 12 })).toBe(false);
  });
});

describe("nextTransition", () => {
  it("keeps NEW numbers aging until 7 days and all checks pass", () => {
    expect(nextTransition({ ...base, daysInState: 6 }, null)).toBeNull();
    expect(nextTransition({ ...base, daysInState: 7, fcrRegistered: false }, null)).toBeNull();
    expect(nextTransition({ ...base, daysInState: 7 }, null)?.to).toBe("WARMING");
  });

  it("cools a labeled ACTIVE number immediately", () => {
    expect(nextTransition({ ...base, lifecycle: "ACTIVE" }, { ...healthy, labeled: true })?.to).toBe("COOLING");
  });

  it("cools on low answer rate only with enough calls to judge", () => {
    expect(nextTransition({ ...base, lifecycle: "ACTIVE" }, { ...healthy, answerRate: 0.05, calls: 10 })).toBeNull();
    expect(nextTransition({ ...base, lifecycle: "ACTIVE" }, { ...healthy, answerRate: 0.05 })?.to).toBe("COOLING");
  });

  it("cools on a SIP 608 spike regardless of volume", () => {
    expect(nextTransition({ ...base, lifecycle: "WARMING", warmupWeek: 1 }, { ...healthy, calls: 3, sip608: 5 })?.to).toBe("COOLING");
  });

  it("promotes WARMING to ACTIVE after the last warm-up week with healthy metrics", () => {
    expect(nextTransition({ ...base, lifecycle: "WARMING", warmupWeek: 3 }, healthy)).toBeNull();
    expect(nextTransition({ ...base, lifecycle: "WARMING", warmupWeek: 4 }, healthy)?.to).toBe("ACTIVE");
  });

  it("returns COOLING to WARMING at day 14 when clean, retires at day 30 when still labeled", () => {
    expect(nextTransition({ ...base, lifecycle: "COOLING", daysInState: 14 }, null)?.to).toBe("WARMING");
    expect(nextTransition({ ...base, lifecycle: "COOLING", daysInState: 14, latestLabelClean: false }, null)).toBeNull();
    expect(nextTransition({ ...base, lifecycle: "COOLING", daysInState: 30, latestLabelClean: false }, null)?.to).toBe("RETIRED");
  });
});
