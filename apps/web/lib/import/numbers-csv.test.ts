import { describe, expect, it } from "vitest";
import { buildImport, normalizeNumber, parseCsv, summarize } from "./numbers-csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and blank lines", () => {
    const rows = parseCsv('number,notes\r\n"(212) 555-0199","Main, NYC ""A"""\r\n\r\n3055550142,plain\n');
    expect(rows).toEqual([
      ["number", "notes"],
      ["(212) 555-0199", 'Main, NYC "A"'],
      ["3055550142", "plain"],
    ]);
  });

  it("detects tab and semicolon delimiters and strips a BOM", () => {
    expect(parseCsv("﻿number\tstate\n2125550199\tNY")).toEqual([["number", "state"], ["2125550199", "NY"]]);
    expect(parseCsv("number;state\n2125550199;NY")).toEqual([["number", "state"], ["2125550199", "NY"]]);
  });
});

describe("normalizeNumber", () => {
  it("accepts common formats and rejects invalid NANP numbers", () => {
    expect(normalizeNumber("+1 (212) 555-0199")).toBe("+12125550199");
    expect(normalizeNumber("12125550199")).toBe("+12125550199");
    expect(normalizeNumber("0000000000")).toBeNull();
    expect(normalizeNumber("2121550199")).toBeNull();
    expect(normalizeNumber("555-0199")).toBeNull();
  });
});

describe("buildImport", () => {
  it("maps flexible headers, fills state from area code, and classifies rows", () => {
    const csv = [
      "Phone Number,ST,Caller Name,STIR/SHAKEN,Activation Date,Monthly Cost,Comments",
      "2125550199,,ACME,A,2026-09-10,$0.25,wave 1",
      "3055550142,FL,,a,9/12/2026,0.25,",
      "(212) 555-0199,,,,,,dup",
      "8005550100,,,,,,toll free",
      "12,,,,,,bad",
      "2135550111,NY,,C,someday,free,mismatch",
    ].join("\n");
    const res = buildImport(csv, [{ e164: "+13055550142", lifecycle: "NEW", notes: "Seen on dialer, not imported" }]);

    expect(res.error).toBeNull();
    expect(res.hasHeader).toBe(true);
    expect(res.mappedColumns.number).toBe("Phone Number");

    const [ny, fl, dup, tollFree, bad, mismatch] = res.rows;
    expect(ny).toMatchObject({ e164: "+12125550199", state: "NY", stateSource: "area code", cnam: "ACME", attestation: "A", purchasedAt: "2026-09-10", mrcCents: 25, notes: "wave 1", status: "new", line: 2 });
    expect(fl).toMatchObject({ state: "FL", stateSource: "file", attestation: "A", purchasedAt: "2026-09-12", status: "update" });
    expect(dup.status).toBe("duplicate");
    expect(tollFree.status).toBe("invalid");
    expect(bad.status).toBe("invalid");
    expect(mismatch.status).toBe("new");
    expect(mismatch.warnings.join(" ")).toMatch(/doesn’t match area code \(CA\)/);
    expect(mismatch.warnings.join(" ")).toMatch(/Attestation C/);
    expect(mismatch.warnings.join(" ")).toMatch(/Ignored date/);
    expect(mismatch.warnings.join(" ")).toMatch(/Ignored monthly cost/);

    expect(summarize(res.rows)).toMatchObject({ total: 6, new: 2, update: 1, duplicate: 1, invalid: 2 });
  });

  it("treats a headerless single-column file as numbers", () => {
    const res = buildImport("2125550199\n3055550142\n", []);
    expect(res.hasHeader).toBe(false);
    expect(res.rows.map((r) => r.status)).toEqual(["new", "new"]);
    expect(res.rows[0].line).toBe(1);
  });

  it("explains a missing number column", () => {
    const res = buildImport("name,city\nAcme,NYC", []);
    expect(res.error).toMatch(/No phone number column/);
  });
});
