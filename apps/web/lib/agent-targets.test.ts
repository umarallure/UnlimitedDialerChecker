import { describe, expect, it } from "vitest";
import { agentTargets, campaignsOf } from "./agent-targets";

describe("campaignsOf", () => {
  it("splits the space-delimited list VICIdial stores", () => {
    expect(campaignsOf(" AG_AGT1 TESTCAMP ")).toEqual(["AG_AGT1", "TESTCAMP"]);
  });

  it("treats the all-campaigns marker as no campaign of their own", () => {
    expect(campaignsOf(" -ALL-CAMPAIGNS- - -")).toEqual([]);
  });

  it("copes with padding, empties and nulls", () => {
    expect(campaignsOf(" - - ")).toEqual([]);
    expect(campaignsOf("")).toEqual([]);
    expect(campaignsOf(null)).toEqual([]);
  });

  it("does not split on letters — a whitespace regex, not the letter s", () => {
    // The bug this replaces split on /s+/, so TESTCAMP became TE, TCAMP.
    expect(campaignsOf(" TESTCAMP AG_SALES ")).toEqual(["TESTCAMP", "AG_SALES"]);
  });
});

describe("agentTargets", () => {
  const groups = [
    { user_group: "UG_agent1", allowed_campaigns: " AG_AGT1 TESTCAMP " },
    { user_group: "ADMIN", allowed_campaigns: " -ALL-CAMPAIGNS- - -" },
    { user_group: "UG_solo", allowed_campaigns: " ONECAMP " },
  ];
  const lists = [
    { list_id: 401, campaign_id: "AG_AGT1", active: true },
    { list_id: 101, campaign_id: "TESTCAMP", active: true },
    { list_id: 777, campaign_id: "ONECAMP", active: true },
  ];

  it("gives an agent the list of their own campaign, not the shared one", () => {
    const [t] = agentTargets([{ user_name: "agent1", full_name: "Agent One", user_group: "UG_agent1" }], groups, lists);
    expect(t).toEqual({ user_name: "agent1", full_name: "Agent One", campaignId: "AG_AGT1", listId: 401 });
  });

  it("gives nothing to an agent who can see every campaign", () => {
    const [t] = agentTargets([{ user_name: "boss", full_name: null, user_group: "ADMIN" }], groups, lists);
    expect(t.campaignId).toBeNull();
    expect(t.listId).toBeNull();
  });

  it("uses the only campaign when there is exactly one, even without the AG_ prefix", () => {
    const [t] = agentTargets([{ user_name: "solo", full_name: null, user_group: "UG_solo" }], groups, lists);
    expect(t).toMatchObject({ campaignId: "ONECAMP", listId: 777 });
  });

  it("returns the agent with no list rather than dropping them", () => {
    const [t] = agentTargets([{ user_name: "new", full_name: null, user_group: "UG_missing" }], groups, lists);
    expect(t).toMatchObject({ user_name: "new", listId: null });
  });

  it("skips an inactive list, which would accept leads nobody dials", () => {
    const [t] = agentTargets(
      [{ user_name: "agent1", full_name: null, user_group: "UG_agent1" }],
      groups,
      [
        { list_id: 401, campaign_id: "AG_AGT1", active: false },
        { list_id: 402, campaign_id: "AG_AGT1", active: true },
      ],
    );
    expect(t.listId).toBe(402);
  });

  it("gives nothing when the user's group was never synced", () => {
    const [t] = agentTargets([{ user_name: "x", full_name: null }], groups, lists);
    expect(t.listId).toBeNull();
  });
});
