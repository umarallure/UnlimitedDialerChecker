"use client";
import { useEffect, useMemo, useState } from "react";
import { Alert, DataTable, EmptyRow, StatusPill } from "@/components/ui";
import { agentTone } from "@/lib/status";
import { createClient } from "@/lib/supabase/client";

type AgentRow = {
  agent_user: string;
  full_name: string | null;
  status: string;
  pause_code: string | null;
  campaign_id: string | null;
  calls_today: number | null;
  state_since: string | null;
  updated_at: string;
};

export function AgentsBoard() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: loadError } = await supabase.from("agents_live").select("*").order("agent_user");
      if (loadError) setError(loadError.message);
      else setRows(data as AgentRow[]);
    }
    load();
    const channel = supabase
      .channel("agents_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents_live" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  if (error) return <Alert>Couldn’t load agents: {error}</Alert>;

  return (
    <DataTable head={["Agent", "Status", "Campaign", "Calls today", "In state since"]} minWidth={600}>
      {rows.length === 0 ? (
        <EmptyRow colSpan={5}>No agents logged in.</EmptyRow>
      ) : (
        rows.map((r) => (
          <tr key={r.agent_user} className="hover:bg-surface-alt">
            <td>
              <span className="flex flex-col">
                <span className="font-semibold text-ink">{r.full_name ?? r.agent_user}</span>
                {r.full_name && <span className="text-legal text-muted">{r.agent_user}</span>}
              </span>
            </td>
            <td>
              <StatusPill tone={agentTone(r.status)}>
                {r.status}
                {r.pause_code ? ` · ${r.pause_code}` : ""}
              </StatusPill>
            </td>
            <td>{r.campaign_id ?? "—"}</td>
            <td className="tabular-nums">{r.calls_today ?? 0}</td>
            <td className="tabular-nums">{r.state_since ? new Date(r.state_since).toLocaleTimeString() : "—"}</td>
          </tr>
        ))
      )}
    </DataTable>
  );
}
