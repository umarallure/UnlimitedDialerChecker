"use client";
import { useEffect, useMemo, useState } from "react";
import { Coffee, Headset, PhoneCall, UserCheck } from "lucide-react";
import { Alert, DataTable, EmptyRow, KpiCard, Panel, StatusPill } from "@/components/ui";
import { agentLabel, agentTone } from "@/lib/status";
import { createClient } from "@/lib/supabase/client";
import { formatTime } from "@/lib/time";

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

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

function since(iso: string | null, now: number) {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export function AgentsBoard() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    async function load() {
      const { data, error: loadError } = await supabase.from("agents_live").select("*").order("agent_user");
      if (loadError) setError(loadError.message);
      else {
        setError(null);
        setRows(data as AgentRow[]);
      }
    }
    load();
    const channel = supabase
      .channel("agents_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents_live" }, load)
      .subscribe();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const by = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Logged in" value={rows.length} icon={<Headset className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Ready" value={by("READY")} note="Waiting for a call" noteTone="success" icon={<UserCheck className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="In call" value={by("INCALL") + by("QUEUE")} icon={<PhoneCall className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Paused" value={by("PAUSED")} noteTone="warning" note={by("PAUSED") ? "Check pause reasons" : undefined} icon={<Coffee className="size-5" strokeWidth={1.75} />} />
      </div>

      {error && <Alert>Couldn’t load agents: {error}</Alert>}

      <Panel title="Live board" subtitle="Time in state counts up in real time." bodyClassName="px-2 pb-2">
        <DataTable head={["Agent", "Status", "Time in state", "Campaign", "Calls today", "Last sync"]} minWidth={680} bare>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>No agents logged in.</EmptyRow>
          ) : (
            rows.map((r) => {
              const name = r.full_name ?? r.agent_user;
              return (
                <tr key={r.agent_user}>
                  <td>
                    <span className="flex items-center gap-3">
                      <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-surface-alt text-legal font-semibold text-ink">
                        {initials(name)}
                      </span>
                      <span className="flex flex-col">
                        <span className="font-semibold text-ink">{name}</span>
                        {r.full_name && <span className="text-legal text-muted">{r.agent_user}</span>}
                      </span>
                    </span>
                  </td>
                  <td>
                    <StatusPill tone={agentTone(r.status)}>
                      {agentLabel(r.status)}
                      {r.pause_code ? ` · ${r.pause_code}` : ""}
                    </StatusPill>
                  </td>
                  <td className="tabular-nums">{since(r.state_since, now)}</td>
                  <td>{r.campaign_id ?? "—"}</td>
                  <td className="tabular-nums">{r.calls_today ?? 0}</td>
                  <td className="tabular-nums">{formatTime(r.updated_at)}</td>
                </tr>
              );
            })
          )}
        </DataTable>
      </Panel>
    </>
  );
}
