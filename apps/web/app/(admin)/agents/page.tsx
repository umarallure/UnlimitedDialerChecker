import { AddAgentButton } from "@/components/agents/add-agent-button";
import { DataTable, EmptyRow, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { AgentsBoard } from "./agents-board";

export default async function AgentsPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: users }, { data: lists }] = await Promise.all([
    supabase.from("dialer_users").select("user_name, full_name, user_level, user_group, active").lte("user_level", 7).order("user_name"),
    supabase.from("dialer_lists").select("list_id, list_name, campaign_id, leads").order("list_id"),
  ]);

  // Suggest the next free list number rather than making someone look one up.
  const highest = (lists ?? []).reduce((n, l) => Math.max(n, l.list_id), 300);
  const listByCampaign = new Map<string, { list_id: number; leads: number }[]>();
  for (const l of lists ?? []) {
    if (!l.campaign_id) continue;
    listByCampaign.set(l.campaign_id, [...(listByCampaign.get(l.campaign_id) ?? []), { list_id: l.list_id, leads: l.leads }]);
  }

  return (
    <>
      <PageHeader
        title="Agents"
        description="VICIdial agent states, synced from the dialer every 15 minutes."
        action={<AddAgentButton nextListId={highest + 1} />}
      />
      <AgentsBoard />

      <Panel title="Everyone on the dialer" subtitle="Agent accounts and the campaign each one may use." bodyClassName="px-2 pb-2">
          <DataTable head={["Agent", "Name", "Group", "Lists", "Status"]} minWidth={620} bare>
            {(users ?? []).length === 0 ? (
              <EmptyRow colSpan={5}>No agents have synced yet.</EmptyRow>
            ) : (
              (users ?? []).map((u) => {
                const campaign = u.user_group?.startsWith("UG_") ? `AG_${u.user_group.slice(3).toUpperCase()}`.slice(0, 8) : null;
                const owned = campaign ? (listByCampaign.get(campaign) ?? []) : [];
                return (
                  <tr key={u.user_name}>
                    <td className="font-semibold !text-ink">{u.user_name}</td>
                    <td>{u.full_name ?? "—"}</td>
                    <td>{u.user_group ?? "—"}</td>
                    <td className="tabular-nums">
                      {owned.length === 0 ? <span className="text-muted">—</span> : owned.map((l) => `${l.list_id} (${l.leads})`).join(", ")}
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
