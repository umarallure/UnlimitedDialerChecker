import { describe, expect, it } from "vitest";
import { aggregateByCid, localDay, type CallRow } from "./aggregate";
import { normalizeCid, resolveCid } from "./cid";

describe("normalizeCid", () => {
  it("accepts 10- and 11-digit US numbers in any format", () => {
    expect(normalizeCid("2125550199")).toBe("+12125550199");
    expect(normalizeCid("12125550199")).toBe("+12125550199");
    expect(normalizeCid("+1 (212) 555-0199")).toBe("+12125550199");
  });

  it("rejects placeholders and invalid area codes/exchanges", () => {
    expect(normalizeCid("0000000000")).toBeNull();
    expect(normalizeCid("1234567890")).toBeNull();
    expect(normalizeCid("2121550199")).toBeNull();
    expect(normalizeCid("")).toBeNull();
    expect(normalizeCid(null)).toBeNull();
  });

  it("applies the override only when the logged CID is invalid", () => {
    expect(resolveCid("0000000000", "+12125550199")).toBe("+12125550199");
    expect(resolveCid("3055550142", "+12125550199")).toBe("+13055550142");
    expect(resolveCid("0000000000", null)).toBeNull();
  });
});

const now = new Date(2026, 8, 17, 12, 0, 0);
const base: CallRow = {
  callerCode: "x",
  callDate: new Date(2026, 8, 17, 11, 30),
  outboundCid: "3055550142",
  uniqueid: "u",
  status: "NA",
  lengthSec: 0,
  agentUser: null,
  campaignId: "C",
  phoneNumber: "5551110000",
  callType: "AUTO",
  sipCode: null,
  humanAnswered: false,
};

describe("aggregateByCid", () => {
  it("counts calls, last hour, answered, short calls, drops and SIP rejects per CID", () => {
    const rows: CallRow[] = [
      { ...base, callerCode: "1" },
      { ...base, callerCode: "2", callDate: new Date(2026, 8, 17, 9, 0), phoneNumber: "5551110001" },
      { ...base, callerCode: "3", status: "SALE", humanAnswered: true, lengthSec: 180 },
      { ...base, callerCode: "4", status: "NI", humanAnswered: true, lengthSec: 3 },
      { ...base, callerCode: "5", status: "DROP", humanAnswered: true, lengthSec: 1 },
      { ...base, callerCode: "6", sipCode: 608 },
      { ...base, callerCode: "7", outboundCid: "0000000000" },
    ];
    const agg = aggregateByCid(rows, { now, shortCallSeconds: 6, cidOverride: null });
    expect([...agg.keys()]).toEqual(["+13055550142"]);
    const c = agg.get("+13055550142")!;
    expect(c.calls).toBe(6);
    expect(c.callsLastHour).toBe(5);
    expect(c.answered).toBe(3);
    expect(c.shortCalls).toBe(2);
    expect(c.drops).toBe(1);
    expect(c.sipRejects).toBe(1);
    expect(c.sip608).toBe(1);
    expect(c.talkSecTotal).toBe(184);
    expect(c.uniqueNumbers.size).toBe(2);
  });

  it("attributes placeholder CIDs to the override number", () => {
    const agg = aggregateByCid([{ ...base, outboundCid: "0000000000" }], { now, shortCallSeconds: 6, cidOverride: "+12125550199" });
    expect(agg.get("+12125550199")?.calls).toBe(1);
  });

  it("does not count an answered call with unknown length as short", () => {
    const agg = aggregateByCid([{ ...base, status: "INCALL", humanAnswered: true, lengthSec: null }], { now, shortCallSeconds: 6, cidOverride: null });
    expect(agg.get("+13055550142")?.shortCalls).toBe(0);
  });
});

describe("localDay", () => {
  it("formats the local calendar date", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
