import { describe, expect, it } from "vitest";
import { setupChecklist, setupProgress } from "./number-actions";

const blank = { fcr_registered_at: null, inbound_route_ok: false, attestation: null, cnam: null };

describe("setup checklist", () => {
  it("counts only required steps toward progress", () => {
    expect(setupProgress(blank)).toEqual({ done: 0, total: 3 });
    expect(setupProgress({ ...blank, cnam: "ACME" })).toEqual({ done: 0, total: 3 });
    expect(setupProgress({ fcr_registered_at: "2026-09-17T00:00:00Z", inbound_route_ok: true, attestation: "A", cnam: null })).toEqual({ done: 3, total: 3 });
  });

  it("only treats attestation A as done", () => {
    const att = (a: string | null) => setupChecklist({ ...blank, attestation: a }).find((i) => i.key === "attestation")!.done;
    expect(att("A")).toBe(true);
    expect(att("B")).toBe(false);
    expect(att(null)).toBe(false);
  });
});
