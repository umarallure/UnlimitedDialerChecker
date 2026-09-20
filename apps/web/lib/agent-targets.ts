/**
 * Working out which list each agent's leads should go to.
 *
 * VICIdial does not record "this agent's list" anywhere: it records which campaigns a user's
 * group admits, and which campaign each list belongs to. So the agent's own list is derived —
 * their group's campaign, then that campaign's list.
 */

export type DialerUser = { user_name: string; full_name: string | null; user_group?: string | null };
export type DialerGroup = { user_group: string; allowed_campaigns: string | null };
export type DialerList = { list_id: number; campaign_id: string | null; active?: boolean };

export type AgentTarget = { user_name: string; full_name: string | null; campaignId: string | null; listId: number | null };

const ALL_CAMPAIGNS = "-ALL-CAMPAIGNS-";

/** The campaigns a group admits. Space-delimited in VICIdial, with '-' as padding. */
export function campaignsOf(allowed: string | null | undefined): string[] {
  const raw = (allowed ?? "").trim();
  if (!raw || raw.includes(ALL_CAMPAIGNS)) return [];
  return raw.split(/\s+/).filter((c) => c && c !== "-");
}

/**
 * Pair each agent with the list their leads belong in.
 *
 * An agent admitted to several campaigns has one of their own — the one created with them,
 * named AG_*. Anything else they merely have access to, like a shared test campaign, and
 * importing into it would hand their leads to everybody.
 */
export function agentTargets(users: DialerUser[], groups: DialerGroup[], lists: DialerList[]): AgentTarget[] {
  const byGroup = new Map(groups.map((g) => [g.user_group, campaignsOf(g.allowed_campaigns)]));

  const listsByCampaign = new Map<string, DialerList[]>();
  for (const l of lists) {
    if (!l.campaign_id) continue;
    listsByCampaign.set(l.campaign_id, [...(listsByCampaign.get(l.campaign_id) ?? []), l]);
  }

  return users.map((u) => {
    const campaigns = byGroup.get(u.user_group ?? "") ?? [];
    const own = campaigns.find((c) => c.startsWith("AG_")) ?? (campaigns.length === 1 ? campaigns[0] : null);
    const candidates = own ? (listsByCampaign.get(own) ?? []) : [];
    // An inactive list would accept leads that never get dialled.
    const list = candidates.find((l) => l.active !== false) ?? null;
    return { user_name: u.user_name, full_name: u.full_name, campaignId: own, listId: list?.list_id ?? null };
  });
}
