import { describe, expect, it } from "vitest";
import { type Disposition, validateDisposition } from "./dispositions";

const ok: Disposition = { status: "WN", name: "Wrong number" };

describe("validateDisposition", () => {
  it("accepts a sound code and name", () => {
    expect(validateDisposition(ok)).toBeNull();
    expect(validateDisposition({ status: "DNQ", name: "Does not qualify" })).toBeNull();
  });

  it("holds codes to the six capitals VICIdial allows", () => {
    expect(validateDisposition({ ...ok, status: "W" })).toMatch(/2 to 6/);
    expect(validateDisposition({ ...ok, status: "TOOLONG" })).toMatch(/2 to 6/);
    expect(validateDisposition({ ...ok, status: "wn" })).toMatch(/capitals/);
    expect(validateDisposition({ ...ok, status: "W-N" })).toMatch(/capitals/);
  });

  it("insists on a name an agent can read", () => {
    expect(validateDisposition({ ...ok, name: "" })).toMatch(/name/);
    expect(validateDisposition({ ...ok, name: "x".repeat(31) })).toMatch(/30 characters/);
  });
});
