import { describe, expect, it } from "vitest";
import { LeadLinkError, exampleLink, fromWebFormAddress, toWebFormAddress } from "./lead-link";

describe("toWebFormAddress", () => {
  it("swaps {id} for the marker VICIdial substitutes on the dialer", () => {
    expect(toWebFormAddress("https://crm.example.com/leads/{id}")).toBe("https://crm.example.com/leads/--A--source_id--B--");
  });

  it("handles the id appearing in a query string, or twice", () => {
    expect(toWebFormAddress("https://crm.example.com/open?lead={id}&ref={id}")).toBe(
      "https://crm.example.com/open?lead=--A--source_id--B--&ref=--A--source_id--B--",
    );
  });

  it("insists on a marker, so the button cannot open the same page for every lead", () => {
    expect(() => toWebFormAddress("https://crm.example.com/leads")).toThrow(LeadLinkError);
  });

  it("refuses something that is not a web address", () => {
    expect(() => toWebFormAddress("crm.example.com/{id}")).toThrow(/full web address/);
    expect(() => toWebFormAddress("javascript:alert(1)/{id}")).toThrow(LeadLinkError);
    expect(() => toWebFormAddress("   ")).toThrow(LeadLinkError);
  });
});

describe("fromWebFormAddress", () => {
  it("shows a stored address back in the form it was typed", () => {
    expect(fromWebFormAddress("https://crm.example.com/leads/--A--source_id--B--")).toBe("https://crm.example.com/leads/{id}");
  });

  it("is empty when nothing is set", () => {
    expect(fromWebFormAddress(null)).toBe("");
  });
});

describe("exampleLink", () => {
  it("shows what an agent would open", () => {
    expect(exampleLink("https://crm.example.com/leads/{id}", "abc")).toBe("https://crm.example.com/leads/abc");
  });
});
