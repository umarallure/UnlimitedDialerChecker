import { CrmImport, type Connection } from "@/components/leads/crm-import";
import { LeadImportForm } from "@/components/leads/import-form";
import { Alert, DataTable, EmptyRow, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { agentTargets } from "@/lib/agent-targets";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, relative } from "@/lib/time";

export default async function LeadImportPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: lists }, { data: agents }, { data: history }, { data: crm }, { data: groups }] = await Promise.all([
    supabase.from("dialer_lists").select("list_id, list_name, campaign_id, active").order("active", { ascending: false }).order("list_id"),
    supabase.from("dialer_users").select("user_name, full_name, user_level, user_group, active").eq("active", true).lte("user_level", 7).order("user_name"),
    supabase.from("lead_imports").select("id, list_id, owner, file_name, total, added, duplicates, failed, created_by, created_at, finished_at").order("created_at", { ascending: false }).limit(10),
    supabase.from("crm_connections").select("id, name, source_schema, source_table, column_map, filters, status, last_error, last_import_at").order("created_at").limit(1).maybeSingle(),
    supabase.from("dialer_user_groups").select("user_group, allowed_campaigns"),
  ]);

  const targets = agentTargets(agents ?? [], groups ?? [], lists ?? []);

  return (
    <>
      <PageHeader
        title="Import leads"
        description="Load a CSV into a dialer list. Columns are matched to VICIdial’s fields, so an export from your CRM works without reshaping it first."
      />

      {(lists ?? []).length === 0 && <Alert tone="warning">No lists have synced from the dialer yet. The agent sends them every 15 minutes.</Alert>}

      <Panel title="From a CSV file" bodyClassName="px-6 pb-6">
        <LeadImportForm lists={lists ?? []} agents={agents ?? []} />
      </Panel>

      <Panel
        title="From your CRM"
        subtitle="Read leads straight out of another database, filtered, without exporting a file."
        bodyClassName="px-6 pb-6"
      >
        <CrmImport connection={(crm as Connection | null) ?? null} agents={targets} />
      </Panel>

      <Panel title="Recent imports" subtitle="Newest first." bodyClassName="px-2 pb-2">
        <DataTable head={["Started", "File", "List", "Owner", "Added", "Duplicates", "Failed", "By"]} minWidth={900} bare>
          {(history ?? []).length === 0 ? (
            <EmptyRow colSpan={8}>Nothing imported yet.</EmptyRow>
          ) : (
            (history ?? []).map((h) => (
              <tr key={h.id}>
                <td className="tabular-nums">
                  <span className="flex flex-col">
                    <span>{formatDateTime(h.created_at)}</span>
                    <span className="text-legal text-muted">{h.finished_at ? `finished ${relative(h.finished_at)}` : "in progress"}</span>
                  </span>
                </td>
                <td className="max-w-[220px] truncate" title={h.file_name ?? ""}>
                  {h.file_name ?? "—"}
                </td>
                <td className="tabular-nums">{h.list_id}</td>
                <td>{h.owner ?? <span className="text-muted">open</span>}</td>
                <td className="tabular-nums">
                  <StatusPill tone={h.added > 0 ? "success" : "neutral"}>{h.added}</StatusPill>
                </td>
                <td className="tabular-nums">{h.duplicates}</td>
                <td className="tabular-nums">{h.failed > 0 ? <StatusPill tone="error">{h.failed}</StatusPill> : 0}</td>
                <td className="max-w-[200px] truncate">{h.created_by}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Panel>
    </>
  );
}
