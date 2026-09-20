import { describe, expect, it } from "vitest";
import { numbersHref, parseFilters, searchClause } from "./numbers-filters";

describe("parseFilters", () => {
  it("falls back to defaults for missing or unknown values", () => {
    expect(parseFilters({})).toEqual({ q: "", lifecycle: null, state: null, hold: null, page: 1, size: 50 });
    expect(parseFilters({ lifecycle: "SLEEPING", state: "Florida", hold: "maybe" })).toMatchObject({ lifecycle: null, state: null, hold: null });
  });

  it("keeps recognised values and upper-cases the state", () => {
    expect(parseFilters({ q: "728", lifecycle: "ACTIVE", state: "fl", hold: "held", size: "100", page: "2" })).toEqual({
      q: "728",
      lifecycle: "ACTIVE",
      state: "FL",
      hold: "held",
      page: 2,
      size: 100,
    });
  });
});

describe("searchClause", () => {
  it("matches an area code exactly and the number loosely", () => {
    expect(searchClause("728")).toBe("e164.ilike.%728%,area_code.eq.728,cnam.ilike.%728%");
  });

  it("treats a two-letter search as a state", () => {
    expect(searchClause("fl")).toBe("state.eq.FL,cnam.ilike.%fl%");
  });

  it("drops characters that are PostgREST filter syntax", () => {
    expect(searchClause("x,lifecycle.eq.RETIRED)")).not.toContain("lifecycle.eq.RETIRED)");
  });
});

describe("numbersHref", () => {
  it("omits defaults so a clean view has a clean URL", () => {
    expect(numbersHref(parseFilters({}))).toBe("/numbers");
  });

  it("carries filters onto other pages", () => {
    const f = parseFilters({ q: "728", lifecycle: "ACTIVE", state: "fl", hold: "free", page: "2" });
    expect(numbersHref(f, { page: 5 })).toBe("/numbers?q=728&lifecycle=ACTIVE&state=FL&hold=free&page=5");
  });
});
