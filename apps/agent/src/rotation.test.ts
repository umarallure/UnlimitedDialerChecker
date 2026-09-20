import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type DidRow } from "@udc/policy";
import { cidEntriesFor } from "./rotation";

const NOW = new Date("2026-09-20T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const did: DidRow = {
  id: "a",
  e164: "+17285003009",
  lifecycle: "ACTIVE",
  lifecycleSince: ago(30),
  warmupWeek: 0,
  manualHold: false,
  dailyCap: 60,
  hourlyCap: 12,
  capOverride: null,
  fcrRegisteredAt: ago(30),
  inboundRouteOk: true,
  latestLabel: "clean",
};

const idle = new Map<string, { callsToday: number; callsLastHour: number }>();

function entries(dids: DidRow[], usage = idle) {
  return cidEntriesFor(dids, usage, DEFAULT_POLICY, NOW);
}

describe("cidEntriesFor", () => {
  it("turns an active number on, with its area code split out", () => {
    expect(entries([did])).toEqual([{ areacode: "728", cid: "7285003009", active: "Y", description: "ACTIVE cap 60" }]);
  });

  it("leaves aging, cooling and held numbers off", () => {
    expect(entries([{ ...did, lifecycle: "NEW" }])[0].active).toBe("N");
    expect(entries([{ ...did, lifecycle: "COOLING" }])[0].active).toBe("N");
    expect(entries([{ ...did, manualHold: true }])[0].active).toBe("N");
  });

  it("drops retired numbers from the group entirely", () => {
    expect(entries([{ ...did, lifecycle: "RETIRED" }])).toEqual([]);
  });

  it("switches a number off once it reaches its daily cap", () => {
    const usage = new Map([["a", { callsToday: 60, callsLastHour: 0 }]]);
    expect(entries([did], usage)[0].active).toBe("N");
    expect(entries([did], new Map([["a", { callsToday: 59, callsLastHour: 0 }]]))[0].active).toBe("Y");
  });

  it("switches a number off for the rest of the hour at the hourly cap", () => {
    expect(entries([did], new Map([["a", { callsToday: 10, callsLastHour: 12 }]]))[0].active).toBe("N");
  });

  it("uses the warm-up cap for the number's current week", () => {
    const warming = { ...did, lifecycle: "WARMING" as const, lifecycleSince: ago(8), dailyCap: 20 };
    expect(entries([warming])[0].description).toBe("WARMING cap 40");
    expect(entries([warming], new Map([["a", { callsToday: 40, callsLastHour: 0 }]]))[0].active).toBe("N");
  });

  it("honours an operator cap override in both directions", () => {
    expect(entries([{ ...did, capOverride: 0 }])[0].active).toBe("N");
    const raised = entries([{ ...did, capOverride: 80 }], new Map([["a", { callsToday: 70, callsLastHour: 0 }]]));
    expect(raised[0]).toMatchObject({ active: "Y", description: "ACTIVE cap 80" });
  });
});
