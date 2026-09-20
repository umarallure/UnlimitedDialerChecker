import { describe, expect, it } from "vitest";
import { DEFAULT_DIAL_SETTINGS, type Capacity, type DialSettings, planCapacity, settingsDrift, validateDialPlan } from "./dialing";

// The real dialer: 23 trunks, Teleinx carries 300 channels, a few lines kept for inbound.
const capacity: Capacity = { agents: 5, serverTrunks: 23, carrierChannels: 300, reservedLines: 3 };

const predictive: DialSettings = { ...DEFAULT_DIAL_SETTINGS, dialMethod: "ADAPT_TAPERED", linesPerAgent: 2, hopperLevel: 20 };

function errors(s: DialSettings, c: Capacity = capacity) {
  return validateDialPlan(s, c).filter((i) => i.level === "error");
}

describe("planCapacity", () => {
  it("counts lines against the smaller of the dialer and the carrier", () => {
    expect(planCapacity(predictive, capacity)).toMatchObject({ linesNeeded: 10, linesAvailable: 20, limitedBy: "none", headroom: 10 });
  });

  it("names the dialer when its trunks run out first", () => {
    const plan = planCapacity({ ...predictive, linesPerAgent: 3 }, { ...capacity, agents: 8 });
    expect(plan).toMatchObject({ linesNeeded: 24, linesAvailable: 20, limitedBy: "server" });
  });

  it("names the carrier when it is the smaller ceiling", () => {
    const plan = planCapacity({ ...predictive, linesPerAgent: 3 }, { ...capacity, serverTrunks: 100, carrierChannels: 10 });
    expect(plan.limitedBy).toBe("carrier");
  });

  it("reports the highest lines per agent that still fits", () => {
    expect(planCapacity(predictive, capacity).maxFittingLinesPerAgent).toBe(4);
    expect(planCapacity(predictive, { ...capacity, agents: 7 }).maxFittingLinesPerAgent).toBe(2.8);
  });

  it("does not divide by zero with no agents", () => {
    expect(planCapacity(predictive, { ...capacity, agents: 0 }).maxFittingLinesPerAgent).toBe(0);
  });
});

describe("validateDialPlan", () => {
  it("accepts a sane predictive plan", () => {
    expect(errors(predictive)).toEqual([]);
  });

  it("refuses an abandon rate above the 3% rule", () => {
    const [e] = errors({ ...predictive, maxDropPct: 5 });
    expect(e?.field).toBe("maxDropPct");
  });

  it("refuses several lines per agent on manual dialing", () => {
    const [e] = errors({ ...predictive, dialMethod: "MANUAL", linesPerAgent: 3 });
    expect(e?.field).toBe("dialMethod");
  });

  it("refuses a plan that does not fit the trunks, and says what does", () => {
    const [e] = errors({ ...predictive, linesPerAgent: 3 }, { ...capacity, agents: 8 });
    expect(e?.field).toBe("capacity");
    expect(e?.message).toContain("24 calls at once");
    expect(e?.message).toContain("2.5 lines per agent");
  });

  it("refuses a ceiling below the dial level", () => {
    expect(errors({ ...predictive, linesPerAgent: 3, maxLinesPerAgent: 2 }).map((e) => e.field)).toContain("maxLinesPerAgent");
  });

  it("warns about an aggressive dial level and a short ring", () => {
    const w = validateDialPlan({ ...predictive, linesPerAgent: 3, dialTimeoutSec: 15 }, capacity).filter((i) => i.level === "warning");
    expect(w.map((i) => i.field)).toEqual(expect.arrayContaining(["linesPerAgent", "dialTimeoutSec"]));
  });

  it("warns when drops are only counted after the 2-second rule", () => {
    expect(validateDialPlan({ ...predictive, dropCallSeconds: 5 }, capacity).some((i) => i.field === "dropCallSeconds")).toBe(true);
    expect(validateDialPlan(predictive, capacity).some((i) => i.field === "dropCallSeconds")).toBe(false);
  });

  it("warns when the hopper is too small to keep the dialer fed", () => {
    const i = validateDialPlan({ ...predictive, hopperLevel: 5 }, capacity).find((x) => x.field === "hopperLevel");
    expect(i?.message).toContain("about 20");
  });

  it("leaves a manual campaign alone", () => {
    expect(errors({ ...DEFAULT_DIAL_SETTINGS, hopperLevel: 1 })).toEqual([]);
  });

  it("sorts errors before warnings", () => {
    const issues = validateDialPlan({ ...predictive, maxDropPct: 9, dialTimeoutSec: 10 }, capacity);
    expect(issues[0].level).toBe("error");
  });
});

describe("settingsDrift", () => {
  it("reports only the fields VICIdial actually differs on", () => {
    expect(settingsDrift(predictive, { linesPerAgent: 1, dialMethod: "ADAPT_TAPERED" })).toEqual([{ field: "linesPerAgent", desired: 2, live: 1 }]);
  });

  it("is empty when nothing has been synced yet", () => {
    expect(settingsDrift(predictive, null)).toEqual([]);
  });
});
