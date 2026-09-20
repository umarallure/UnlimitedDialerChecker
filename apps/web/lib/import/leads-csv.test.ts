import { describe, expect, it } from "vitest";
import { chunk, mapRows, normalizePhone, parseCsv, suggestMapping } from "./leads-csv";

describe("parseCsv", () => {
  it("keeps commas that are inside quoted fields", () => {
    const rows = parseCsv('name,address\n"Smith, John","12 High St, Apt 4"');
    expect(rows[1]).toEqual(["Smith, John", "12 High St, Apt 4"]);
  });

  it("handles doubled quotes and both line endings", () => {
    const rows = parseCsv('a,b\r\n"say ""hi""",2\n3,4');
    expect(rows).toEqual([
      ["a", "b"],
      ['say "hi"', "2"],
      ["3", "4"],
    ]);
  });

  it("strips the byte order mark Excel writes", () => {
    expect(parseCsv("﻿phone,name\n2125550147,A")[0][0]).toBe("phone");
  });

  it("drops blank lines rather than making empty leads", () => {
    expect(parseCsv("a\n\n\nb")).toEqual([["a"], ["b"]]);
  });
});

describe("suggestMapping", () => {
  it("recognises common CRM header spellings", () => {
    const m = suggestMapping(["Record ID", "First Name", "Surname", "Cell Phone", "Email Address", "Zip Code"]);
    expect(m.vendorLeadCode).toBe(0);
    expect(m.firstName).toBe(1);
    expect(m.lastName).toBe(2);
    expect(m.phoneNumber).toBe(3);
    expect(m.email).toBe(4);
    expect(m.postalCode).toBe(5);
  });

  it("does not let phone claim the column meant for phone2", () => {
    const m = suggestMapping(["phone2", "phone"]);
    expect(m.phoneNumber).toBe(1);
    expect(m.altPhone).toBe(0);
  });

  it("leaves fields unmapped when nothing matches", () => {
    expect(suggestMapping(["alpha", "beta"]).phoneNumber).toBeUndefined();
  });
});

describe("normalizePhone", () => {
  it("accepts formatting and a leading country code", () => {
    expect(normalizePhone("(212) 555-0147")).toBe("2125550147");
    expect(normalizePhone("+1 212 555 0147")).toBe("2125550147");
  });

  it("rejects numbers that are not dialable", () => {
    expect(normalizePhone("0125550147")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("mapRows", () => {
  const headers = ["Phone", "First", "Last", "State", "Notes"];
  const mapping = suggestMapping(headers);

  it("maps a straightforward file", () => {
    const rows = [headers, ["(212) 555-0147", "Ann", "Lee", "ny", "called before"]];
    const out = mapRows(rows, mapping);
    expect(out.leads).toEqual([
      { phoneNumber: "2125550147", firstName: "Ann", lastName: "Lee", state: "NY", comments: "called before", address1: undefined, city: undefined, postalCode: undefined, email: undefined, altPhone: undefined, vendorLeadCode: undefined },
    ]);
  });

  it("reports unusable rows with their line number instead of dropping them", () => {
    const rows = [headers, ["", "Bob", "", "", ""], ["555", "Cat", "", "", ""]];
    const out = mapRows(rows, mapping);
    expect(out.leads).toHaveLength(0);
    expect(out.skipped).toEqual([
      { line: 2, phone: "", reason: "No phone number" },
      { line: 3, phone: "555", reason: "Not a valid US number" },
    ]);
  });

  it("keeps the first of a number repeated within the file", () => {
    const rows = [headers, ["2125550147", "A", "", "", ""], ["(212) 555-0147", "B", "", "", ""]];
    const out = mapRows(rows, mapping);
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0].firstName).toBe("A");
    expect(out.duplicatesInFile).toBe(1);
  });

  it("truncates values to the lengths VICIdial accepts", () => {
    const rows = [headers, ["2125550147", "x".repeat(50), "", "", "y".repeat(400)]];
    const out = mapRows(rows, mapping);
    expect(out.leads[0].firstName).toHaveLength(30);
    expect(out.leads[0].comments).toHaveLength(255);
  });

  it("returns nothing when no phone column was chosen", () => {
    expect(mapRows([headers, ["2125550147"]], {}).leads).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits evenly and keeps the remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("suggestMapping, two-pass behaviour", () => {
  it("gives Email Address to email, not to address", () => {
    const m = suggestMapping(["Phone", "Email Address", "Street Address"]);
    expect(m.email).toBe(1);
    expect(m.address1).toBe(2);
  });

  it("still maps address when there is no email column", () => {
    expect(suggestMapping(["Phone", "Mailing Address"]).address1).toBe(1);
  });
});
