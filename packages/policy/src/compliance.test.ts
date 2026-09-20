import { describe, expect, it } from "vitest";
import { abandonRate, abandonsRemaining, callsToRecover, complianceLevel } from "./compliance";

describe("abandonRate", () => {
  it("measures drops against calls a person answered, not calls placed", () => {
    // 100 calls placed, 20 answered, 1 of those abandoned: 5%, not 1%.
    expect(abandonRate({ connected: 19, drops: 1 })).toBeCloseTo(5, 4);
  });

  it("is null when nobody answered", () => {
    expect(abandonRate({ connected: 0, drops: 0 })).toBeNull();
  });

  it("matches the 20 September test: 3 connected, 6 dropped", () => {
    expect(abandonRate({ connected: 3, drops: 6 })).toBeCloseTo(66.67, 1);
  });
});

describe("complianceLevel", () => {
  it("flags over the cap, near the cap, and healthy", () => {
    expect(complianceLevel(3.1)).toBe("over");
    expect(complianceLevel(3)).toBe("at_risk");
    expect(complianceLevel(2.1)).toBe("at_risk");
    expect(complianceLevel(1.9)).toBe("ok");
    expect(complianceLevel(0)).toBe("ok");
  });

  it("says unknown rather than fine when there is nothing to judge", () => {
    expect(complianceLevel(null)).toBe("unknown");
  });
});

describe("abandonsRemaining", () => {
  it("counts how many more drops the day can absorb", () => {
    // 100 answered, 3% cap = 3 allowed, 1 used.
    expect(abandonsRemaining({ connected: 99, drops: 1 })).toBe(2);
  });

  it("goes negative once the day is over the cap", () => {
    expect(abandonsRemaining({ connected: 3, drops: 6 })).toBe(-6);
  });

  it("is zero before anything is answered", () => {
    expect(abandonsRemaining({ connected: 0, drops: 0 })).toBe(0);
  });
});

describe("callsToRecover", () => {
  it("is null while the day is compliant", () => {
    expect(callsToRecover({ connected: 99, drops: 1 })).toBeNull();
  });

  it("says how many clean connects would dilute the day back under the cap", () => {
    // 6 drops at a 3% cap needs 200 answered calls in total; 9 exist, so 191 more.
    expect(callsToRecover({ connected: 3, drops: 6 })).toBe(191);
  });
});
