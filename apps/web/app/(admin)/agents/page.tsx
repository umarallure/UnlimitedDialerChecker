import { AddAgentButton } from "@/components/agents/add-agent-button";
import { DialerAccessButton } from "@/components/agents/dialer-access-button";
import { DataTable, EmptyRow, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { AgentsBoard } from "./agents-board";

/** VICIdial stores allowed campaigns as a space-delimited list, or the marker for "all of them". */
function campaignsFor(allowed: string | null | undefined): { all: boolean; ids: string[] } {
  const raw = (allowed ?? "").trim();
  if (!raw) return { all: false, ids: [] };
  if (raw.includes("-ALL-CAMPAIGNS-")) return { all: true, ids: [] };
  return { all: false, ids: raw.split(/\s+/).filter((c) => c && c !== "-") };
}

export default async function AgentsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: users }, { data: lists }, { data: groups }, { data: access }] = await Promise.all([
    supabase.from("dialer_users").select("user_name, full_name, user_level, user_group, active").lte("user_level", 7).order("user_name"),
    supabase.from("dialer_lists").select("list_id, list_name, campaign_id, leads").order("list_id"),
    supabase.from("dialer_user_groups").select("user_group, allowed_campaigns"),
    supabase.from("app_agents").select("email, agent_user, phone_login, campaign_id, active").order("email"),
  ]);

  const highest = (lists ?? []).reduce((n, l) => Math.max(n, l.list_id), 300);
  // So a suggested campaign id cannot collide with one that already exists.
  const takenCampaigns = [...new Set((lists ?? []).map((l) => l.campaign_id).filter((c): c is string => Boolean(c)))];
  // Each agent with their own campaign, for the dialer-access form.
  const dialerAccessChoices = (users ?? [])
    .filter((u) => u.active)
    .map((u) => {
      const allowed = campaignsFor((groups ?? []).find((g) => g.user_group === u.user_group)?.allowed_campaigns);
      return { user_name: u.user_name, full_name: u.full_name ?? null, campaign_id: allowed.ids.find((c) => c.startsWith("AG_")) ?? allowed.ids[0] ?? null };
    });

  const allowedByGroup = new Map((groups ?? []).map((g) => [g.user_group, campaignsFor(g.allowed_campaigns)]));

  const listsByCampaign = new Map<string, { list_id: number; leads: number }[]>();
  for (const l of lists ?? []) {
    if (!l.campaign_id) continue;
    listsByCampaign.set(l.campaign_id, [...(listsByCampaign.get(l.campaign_id) ?? []), { list_id: l.list_id, leads: l.leads }]);
  }

  return (
    <>
      <PageHeader
        title="Agents"
        description="VICIdial agent states, synced from the dialer every 15 minutes."
        action={
          <>
            <DialerAccessButton agents={dialerAccessChoices} />
            <AddAgentButton nextListId={highest + 1} takenCampaigns={takenCampaigns} />
          </>
        }
      />
      <AgentsBoard />

      <Panel
        title="Dialer access"
        subtitle="Who can sign in here and land on their own dialer screen instead of the admin tool."
        bodyClassName="px-2 pb-2"
      >
        <DataTable head={["Signs in as", "VICIdial agent", "Phone", "Campaign", "Status"]} minWidth={720} bare>
          {(access ?? []).length === 0 ? (
            <EmptyRow colSpan={5}>Nobody has dialer access yet.</EmptyRow>
          ) : (
            (access ?? []).map((a) => (
              <tr key={a.email}>
                <td className="font-semibold !text-ink">{a.email}</td>
                <td>{a.agent_user}</td>
                <td className="tabular-nums">{a.phone_login}</td>
                <td>{a.campaign_id ? <StatusPill>{a.campaign_id}</StatusPill> : <span className="text-muted">—</span>}</td>
                <td>
                  <StatusPill tone={a.active ? "success" : "neutral"}>{a.active ? "Active" : "Disabled"}</StatusPill>
                </td>
              </tr>
            ))
          )}
        </DataTable>
      </Panel>

      <Panel title="Everyone on the dialer" subtitle="Agent accounts, the campaigns they may use, and the leads waiting in them." bodyClassName="px-2 pb-2">
        <DataTable head={["Agent", "Name", "Group", "Campaigns", "Leads waiting", "Status"]} minWidth={860} bare>
          {(users ?? []).length === 0 ? (
            <EmptyRow colSpan={6}>No agents have synced yet.</EmptyRow>
          ) : (
            (users ?? []).map((u) => {
              const allowed = allowedByGroup.get(u.user_group ?? "") ?? { all: false, ids: [] };
              const campaignLists = allowed.all
                ? [...listsByCampaign.values()].flat()
                : allowed.ids.flatMap((c) => listsByCampaign.get(c) ?? []);
              const leads = campaignLists.reduce((n, l) => n + l.leads, 0);

              return (
                <tr key={u.user_name}>
                  <td className="font-semibold !text-ink">{u.user_name}</td>
                  <td>{u.full_name ?? "—"}</td>
                  <td>{u.user_group ?? "—"}</td>
                  <td>
                    {allowed.all ? (
                      <StatusPill>Every campaign</StatusPill>
                    ) : allowed.ids.length === 0 ? (
                      <span className="text-muted">None</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {allowed.ids.map((c) => (
                          <StatusPill key={c}>{c}</StatusPill>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {campaignLists.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="flex flex-col">
                        <span>{leads.toLocaleString()}</span>
                        <span className="text-legal text-muted">
                          in {campaignLists.length} list{campaignLists.length === 1 ? "" : "s"}
                        </span>
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusPill tone={u.active ? "success" : "neutral"}>{u.active ? "Active" : "Disabled"}</StatusPill>
                  </td>
                </tr>
              );
            })
          )}
        </DataTable>
      </Panel>
    </>
  );
}
