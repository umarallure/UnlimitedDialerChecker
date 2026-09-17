"use client";
import { useEffect, useMemo, useState } from "react";
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

const STATUS_STYLE: Record<string, string> = {
  READY: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  INCALL: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  QUEUE: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  PAUSED: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
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

  if (error) return <p className="text-sm text-red-600">Couldn’t load agents: {error}</p>;

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2">Agent</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Campaign</th>
            <th className="px-3 py-2">Calls today</th>
            <th className="px-3 py-2">In state since</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                No agents logged in.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.agent_user} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="px-3 py-2">{r.full_name ?? r.agent_user}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? "bg-zinc-100 dark:bg-zinc-800"}`}>
                    {r.status}
                    {r.pause_code ? ` · ${r.pause_code}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2">{r.campaign_id ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{r.calls_today ?? 0}</td>
                <td className="px-3 py-2">{r.state_since ? new Date(r.state_since).toLocaleTimeString() : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
