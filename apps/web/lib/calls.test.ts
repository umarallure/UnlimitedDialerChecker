import { describe, expect, it } from "vitest";
import { callsHref, parseFilters, searchClause } from "./calls";

describe("parseFilters", () => {
  it("falls back to defaults for missing or unknown values", () => {
    expect(parseFilters({})).toEqual({ q: "", outcome: null, range: "7d", page: 1, size: 50 });
    expect(parseFilters({ outcome: "banana", range: "99d", size: "7", page: "0" })).toEqual({
      q: "",
      outcome: null,
      range: "7d",
      page: 1,
      size: 50,
    });
  });

  it("keeps recognised values and ignores repeated params", () => {
    expect(parseFilters({ q: " 728 ", outcome: "busy", range: "24h", size: "25", page: "3" })).toEqual({
      q: "728",
      outcome: "busy",
      range: "24h",
      page: 3,
      size: 25,
    });
    expect(parseFilters({ q: ["a", "b"] }).q).toBe("");
  });
});

describe("searchClause", () => {
  it("returns null for empty input", () => {
    expect(searchClause("   ")).toBeNull();
  });

  it("matches a full number on caller ID only", () => {
    expect(searchClause("(728) 500-3009")).toBe("outbound_cid.ilike.%7285003009%,agent_user.ilike.%728 500-3009%,campaign_id.ilike.%728 500-3009%");
  });

  it("matches short digit strings against the lead's last four", () => {
    expect(searchClause("3009")).toContain("lead_phone_last4.eq.3009");
  });

  it("cannot be used to inject an extra filter term", () => {
    // The injected comma would otherwise start a new `or` term of its own.
    const clause = searchClause("agent,status.eq.SALE)") as string;
    expect(clause.split(",")).toEqual(["agent_user.ilike.%agent status.eq.SALE%", "campaign_id.ilike.%agent status.eq.SALE%"]);
  });
});

describe("callsHref", () => {
  it("omits defaults so a clean view has a clean URL", () => {
    expect(callsHref(parseFilters({}))).toBe("/calls");
  });

  it("carries filters onto other pages", () => {
    const f = parseFilters({ q: "728", outcome: "busy", range: "24h", size: "25", page: "2" });
    expect(callsHref(f, { page: 3 })).toBe("/calls?q=728&outcome=busy&range=24h&size=25&page=3");
  });

  it("resets to page 1 when a filter is cleared", () => {
    const f = parseFilters({ q: "728", page: "4" });
    expect(callsHref(f, { q: "", page: 1 })).toBe("/calls");
  });
});
