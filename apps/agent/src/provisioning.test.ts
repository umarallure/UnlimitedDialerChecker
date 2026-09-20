import { describe, expect, it } from "vitest";
import { type NewAgent, validateNewAgent } from "./provisioning";

const ok: NewAgent = {
  user: "agent3",
  password: "a-long-enough-password",
  fullName: "Test Agent 3",
  campaignId: "AG_A3",
  campaignName: "Agent 3",
  listId: 301,
  listName: "Agent 3 main",
};

describe("validateNewAgent", () => {
  it("accepts a sound set of details", () => {
    expect(validateNewAgent(ok)).toBeNull();
  });

  it("holds usernames to what VICIdial accepts", () => {
    expect(validateNewAgent({ ...ok, user: "a" })).toMatch(/username/);
    expect(validateNewAgent({ ...ok, user: "has space" })).toMatch(/username/);
    expect(validateNewAgent({ ...ok, user: "x".repeat(21) })).toMatch(/username/);
  });

  it("keeps campaign ids within the 8 characters VICIdial allows", () => {
    expect(validateNewAgent({ ...ok, campaignId: "TOOLONGCAMPAIGN" })).toMatch(/campaign id/);
    expect(validateNewAgent({ ...ok, campaignId: "ag_a3" })).toMatch(/campaign id/);
  });

  it("refuses a short password", () => {
    expect(validateNewAgent({ ...ok, password: "short" })).toMatch(/password/);
  });

  it("checks the caller ID is a real US number when one is given", () => {
    expect(validateNewAgent({ ...ok, campaignCid: "123" })).toMatch(/caller ID/);
    expect(validateNewAgent({ ...ok, campaignCid: "7285003009" })).toBeNull();
    expect(validateNewAgent({ ...ok, campaignCid: undefined })).toBeNull();
  });

  it("keeps list ids in range", () => {
    expect(validateNewAgent({ ...ok, listId: 99 })).toMatch(/list id/);
    expect(validateNewAgent({ ...ok, listId: 1.5 })).toMatch(/list id/);
  });
});
