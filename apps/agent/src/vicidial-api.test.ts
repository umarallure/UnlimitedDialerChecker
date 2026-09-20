import { describe, expect, it } from "vitest";
import { parseApiResponse } from "./vicidial-api";

describe("parseApiResponse", () => {
  it("reads an error body, which the API returns with HTTP 200", () => {
    const r = parseApiResponse("ERROR: campaigns_list USER DOES NOT HAVE PERMISSION TO GET CAMPAIGN INFO: |udcapi|0|");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("DOES NOT HAVE PERMISSION");
  });

  it("reads the version line", () => {
    const r = parseApiResponse("VERSION: 2.14-209|BUILD: 260907-1808|DATE: 2026-09-20 12:13:06|");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toContain("2.14-209");
  });

  it("splits pipe-delimited rows", () => {
    const r = parseApiResponse("TESTCAMP|Test Campaign|Y|---ALL---|RATIO|3.0||NEW|30|9||\nOTHER|Second|N|");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toHaveLength(2);
      expect(r.rows[0][0]).toBe("TESTCAMP");
      expect(r.rows[1][1]).toBe("Second");
    }
  });

  it("drops the SUCCESS header from the rows", () => {
    const r = parseApiResponse("SUCCESS: lead added\n12345|7285003009|");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.message).toBe("lead added");
      expect(r.rows).toEqual([["12345", "7285003009", ""]]);
    }
  });

  it("treats an empty body as a failure rather than a silent success", () => {
    expect(parseApiResponse("   ").ok).toBe(false);
  });
});
