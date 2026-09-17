import { Card, Metric, PageHeader, SectionLabel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";

const LIFECYCLES = [
  { key: "NEW", note: "Aging 7 days before first call" },
  { key: "WARMING", note: "Ramping 20 → 40 → 60 calls/day" },
  { key: "ACTIVE", note: "In rotation, 60/day cap" },
  { key: "COOLING", note: "Resting 7–14 days" },
  { key: "RETIRED", note: "Out of outbound use" },
] as const;

type LifecycleKey = (typeof LIFECYCLES)[number]["key"];

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

  const byLifecycle = Object.fromEntries(LIFECYCLES.map((l) => [l.key, 0])) as Record<LifecycleKey, number>;
  for (const row of dids.data ?? []) byLifecycle[row.lifecycle as LifecycleKey]++;

  const agentRows = agents.data ?? [];
  const readyAgents = agentRows.filter((a) => a.status === "READY").length;
  const inCall = agentRows.filter((a) => a.status === "INCALL").length;
  const enforcing = policy.data?.enforcement_mode === "enforce";
  const openAlerts = alerts.count ?? 0;
  const dialerRows = dialers.data ?? [];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Caller-ID pool health, live agents and dialer sync at a glance."
        action={
          <StatusPill tone={enforcing ? "success" : "warning"}>
            Rotation: {enforcing ? "enforcing" : "dry run, no changes sent to VICIdial"}
          </StatusPill>
        }
      />

      <section className="flex flex-col gap-4">
        <SectionLabel>Number pool</SectionLabel>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {LIFECYCLES.map((l) => (
            <div key={l.key} className="flex flex-col gap-2 rounded-lg bg-surface-alt p-6">
              <dt>
                <StatusPill tone={LIFECYCLE_TONE[l.key]}>{l.key}</StatusPill>
              </dt>
              <dd className="text-title-lg tabular-nums text-ink">{byLifecycle[l.key]}</dd>
              <dd className="text-legal text-muted">{l.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <SectionLabel>Operations</SectionLabel>
        <dl className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Metric label="Agents logged in" value={agentRows.length} note={`${readyAgents} ready · ${inCall} in call`} />
          <Metric
            label="Open alerts"
            value={<span className={openAlerts > 0 ? "text-error" : undefined}>{openAlerts}</span>}
            note={openAlerts > 0 ? "Review numbers flagged for attention" : "Nothing needs attention"}
          />
          <Metric
            label="Dialer sync"
            value={dialerRows.length === 0 ? "—" : dialerRows.length}
            note={
              dialerRows.length === 0
                ? "No dialer agent connected yet"
                : dialerRows
                    .map((d) => `${d.name}: ${d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleTimeString() : "never"}`)
                    .join(" · ")
            }
          />
        </dl>
      </section>

      {dialerRows.length === 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="text-title-sm text-ink">Next: connect the dialer</h2>
          <p className="max-w-[65ch] text-caption text-muted">
            Phase 1 installs the sync agent on the VICIdial server. Live agents, per-number call counts and heartbeats will
            appear here within seconds of it starting.
          </p>
        </Card>
      )}
    </>
  );
}
