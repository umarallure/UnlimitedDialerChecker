import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const LIFECYCLES = ["NEW", "WARMING", "ACTIVE", "COOLING", "RETIRED"] as const;

export default async function OverviewPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [dids, dialers, alerts, policy, agents] = await Promise.all([
    supabase.from("dids").select("lifecycle"),
    supabase.from("dialers").select("name, last_heartbeat_at, agent_version, status"),
    supabase.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null),
    supabase.from("policies").select("enforcement_mode, updated_at").eq("is_active", true).maybeSingle(),
    supabase.from("agents_live").select("status"),
  ]);

  const byLifecycle = Object.fromEntries(LIFECYCLES.map((l) => [l, 0])) as Record<(typeof LIFECYCLES)[number], number>;
  for (const row of dids.data ?? []) byLifecycle[row.lifecycle as (typeof LIFECYCLES)[number]]++;

  const agentRows = agents.data ?? [];
  const readyAgents = agentRows.filter((a) => a.status === "READY").length;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-zinc-500">
          Rotation mode: <strong>{policy.data?.enforcement_mode === "enforce" ? "Enforcing" : "Dry run (no changes sent to VICIdial)"}</strong>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Number pool</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {LIFECYCLES.map((l) => (
            <div key={l} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <dt className="text-xs text-zinc-500">{l}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{byLifecycle[l]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Agents logged in</div>
          <div className="text-2xl font-semibold tabular-nums">{agentRows.length}</div>
          <div className="text-xs text-zinc-500">{readyAgents} ready</div>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Open alerts</div>
          <div className="text-2xl font-semibold tabular-nums">{alerts.count ?? 0}</div>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="text-xs text-zinc-500">Dialer sync</div>
          {(dialers.data ?? []).length === 0 ? (
            <div className="text-sm">No dialer agent connected yet (Phase 1).</div>
          ) : (
            (dialers.data ?? []).map((d) => (
              <div key={d.name} className="text-sm">
                {d.name}: last heartbeat {d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleString() : "never"}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
