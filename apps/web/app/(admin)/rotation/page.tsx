import Link from "next/link";
import { ArrowRight, Eye, Hash, ListChecks, Repeat } from "lucide-react";
import { RunPreviewButton } from "@/components/rotation/run-button";
import { Alert, DataTable, EmptyRow, KpiCard, Metric, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { KIND_LABEL, KIND_TONE, policyFrom } from "@/lib/rotation";
import { LIFECYCLE_LABEL, LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPhone, relative } from "@/lib/time";

type ProposalKind = keyof typeof KIND_LABEL;
type Metrics = { calls: number; answerRate: number; shortCallPct: number; dropPct: number; sip608: number; labeled: boolean } | null;

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

export default async function RotationPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: policy }, { data: lastRun }, { data: runs }, { data: pool }, { data: scanned }] = await Promise.all([
    supabase.from("policies").select("settings, enforcement_mode, updated_at").eq("is_active", true).maybeSingle(),
    supabase.from("lifecycle_runs").select("id, mode, triggered_by, dids_evaluated, dids_skipped, proposals, applied, error, started_at, finished_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("lifecycle_runs").select("id, mode, triggered_by, dids_evaluated, proposals, applied, error, started_at").order("started_at", { ascending: false }).limit(10),
    supabase.from("dids").select("id, lifecycle"),
    supabase.from("reputation_checks").select("did_id"),
  ]);

  const { data: proposals } = lastRun
    ? await supabase
        .from("lifecycle_proposals")
        .select("id, kind, from_state, to_state, warmup_week, proposed_warmup_week, current_cap, proposed_cap, reason, metrics, applied, dids(e164, state)")
        .eq("run_id", lastRun.id)
        .order("kind")
    : { data: [] };

  const p = policyFrom(policy);
  const enforcing = policy?.enforcement_mode === "enforce";
  const rows = proposals ?? [];
  const inRotation = (pool ?? []).filter((d) => d.lifecycle === "ACTIVE" || d.lifecycle === "WARMING").length;
  // A number may not start warming until a reputation scan says it is clean, so an unscanned
  // pool would sit in aging for ever. Say so rather than letting the engine look stuck.
  const gateOn = p.requireCleanReputation !== false;
  const everScanned = new Set((scanned ?? []).map((r) => r.did_id));
  const unscanned = (pool ?? []).filter((d) => d.lifecycle === "NEW" && !everScanned.has(d.id)).length;

  return (
    <>
      <PageHeader
        title="Rotation"
        description={
          enforcing
            ? "The lifecycle engine ages, warms, rests and retires each number against the policy below, and applies those changes on the dialer."
            : "The lifecycle engine ages, warms, rests and retires each number against the policy below. It is running in preview: it records what it would do without touching the dialer."
        }
        action={<RunPreviewButton />}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="In rotation" value={inRotation} note={`${(pool ?? []).length} numbers in the pool`} icon={<Hash className="size-5" strokeWidth={1.75} />} />
        <KpiCard
          label="Proposed changes"
          value={lastRun?.proposals ?? 0}
          note={lastRun ? `From the run ${relative(lastRun.started_at)}` : "No run yet"}
          noteTone={lastRun?.proposals ? "warning" : "muted"}
          icon={<ListChecks className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard label="Applied" value={lastRun?.applied ?? 0} note={enforcing ? "Enforcement is on" : "Preview only — nothing applied"} icon={<Repeat className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Numbers evaluated" value={lastRun?.dids_evaluated ?? 0} note={lastRun?.dids_skipped ? `${lastRun.dids_skipped} retired, skipped` : undefined} icon={<Eye className="size-5" strokeWidth={1.75} />} />
      </div>

      {lastRun?.error && <Alert>The last run failed: {lastRun.error}</Alert>}

      {unscanned > 0 && (
        <Alert tone="warning">
          {gateOn ? (
            <>
              {unscanned} aging number{unscanned === 1 ? " has" : "s have"} never been checked for spam labels, and the engine will not start warming a number until a scan comes
              back clean. Turn the check off in <Link href="/settings?tab=rotation">Settings → Rotation</Link> until a reputation provider is connected.
            </>
          ) : (
            <>
              Reputation checks are off, so numbers warm up without a spam-label check. A known spam or scam label still holds a number back. Turn the check back on in{" "}
              <Link href="/settings?tab=rotation">Settings → Rotation</Link> once My Call Score is connected.
            </>
          )}
        </Alert>
      )}

      <div
        className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-caption ${
          enforcing ? "border-primary/20 bg-soft-orange text-primary-pressed" : "border-line bg-surface-alt text-graphite"
        }`}
      >
        <StatusPill tone={enforcing ? "accent" : "neutral"}>{enforcing ? "Enforcing" : "Dry run"}</StatusPill>
        {enforcing
          ? "The agent applies these changes on the dialer and marks each one applied."
          : "Nothing here changes the dialer. Proposals are a record of what the engine would have done."}
      </div>

      <Panel
        title="Proposed changes"
        subtitle={lastRun ? `Run ${relative(lastRun.started_at)} by ${lastRun.triggered_by} · ${lastRun.dids_evaluated} number${lastRun.dids_evaluated === 1 ? "" : "s"} evaluated` : "The engine has not run yet."}
        bodyClassName="px-2 pb-2"
      >
        <DataTable head={["Number", "Change", "State", "Daily cap", "Why", "Metrics (3 days)"]} minWidth={980} bare>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>{lastRun ? "Nothing is due. Every number already matches the policy." : "Run a preview to see what the engine would do."}</EmptyRow>
          ) : (
            rows.map((r) => {
              const did = (Array.isArray(r.dids) ? r.dids[0] : r.dids) as { e164: string; state: string | null } | undefined;
              const kind = r.kind as ProposalKind;
              const m = r.metrics as Metrics;
              return (
                <tr key={r.id}>
                  <td>
                    <span className="flex flex-col">
                      <span className="font-semibold text-ink tabular-nums">{formatPhone(did?.e164)}</span>
                      <span className="text-legal text-muted">{did?.state ?? "Unknown state"}</span>
                    </span>
                  </td>
                  <td>
                    <StatusPill tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</StatusPill>
                  </td>
                  <td>
                    {r.to_state ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={LIFECYCLE_TONE[r.from_state]}>{LIFECYCLE_LABEL[r.from_state]}</StatusPill>
                        <ArrowRight aria-hidden className="size-3.5 text-muted" />
                        <StatusPill tone={LIFECYCLE_TONE[r.to_state]}>{LIFECYCLE_LABEL[r.to_state]}</StatusPill>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={LIFECYCLE_TONE[r.from_state]}>{LIFECYCLE_LABEL[r.from_state]}</StatusPill>
                        {r.proposed_warmup_week !== r.warmup_week && <span className="text-legal text-muted">week {r.warmup_week} → {r.proposed_warmup_week}</span>}
                      </span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {r.current_cap} <ArrowRight aria-hidden className="inline size-3.5 text-muted" /> <span className="font-semibold text-ink">{r.proposed_cap}</span>
                  </td>
                  <td className="max-w-[280px]">{r.reason}</td>
                  <td className="tabular-nums">
                    {m ? (
                      <span className="flex flex-col">
                        <span>
                          {m.calls} call{m.calls === 1 ? "" : "s"} · {pct(m.answerRate)} answered
                        </span>
                        <span className="text-legal text-muted">
                          {pct(m.shortCallPct)} short · {pct(m.dropPct)} dropped{m.sip608 ? ` · ${m.sip608} SIP 608` : ""}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">No call data</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </DataTable>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Policy in force" subtitle={policy?.updated_at ? `Last changed ${relative(policy.updated_at)}` : undefined}>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Metric label="Aging" value={`${p.agingDays} days`} note="Before a new number may dial" />
            <Metric label="Warm-up" value={p.warmupDailyCaps.join(" → ")} note="Calls a day, one step a week" />
            <Metric label="Active cap" value={`${p.activeDailyCap} / day`} note={`${p.hourlyCap} an hour`} />
            <Metric label="Cool-off" value={`${p.coolingDays} days`} note={`Retire if still labeled at ${p.retireIfLabeledAtDay} days`} />
            <Metric label="Promote above" value={pct(p.promote.minAnswerRate)} note="3-day answer rate" />
            <Metric label="Cool below" value={pct(p.hardCool.minAnswerRate3d)} note={`Or ${pct(p.hardCool.maxShortCallPct)} short calls, ${p.hardCool.sip608Spike} SIP 608s`} />
          </dl>
        </Panel>

        <Panel title="Recent runs" subtitle="Newest first." bodyClassName="px-2 pb-2">
          <DataTable head={["Started", "Mode", "Triggered by", "Evaluated", "Proposed", "Applied"]} minWidth={620} bare>
            {(runs ?? []).length === 0 ? (
              <EmptyRow colSpan={6}>No runs yet.</EmptyRow>
            ) : (
              (runs ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="tabular-nums">{formatDateTime(r.started_at)}</td>
                  <td>
                    <StatusPill tone={r.mode === "enforce" ? "accent" : "neutral"}>{r.mode === "enforce" ? "Enforce" : "Dry run"}</StatusPill>
                  </td>
                  <td>{r.triggered_by}</td>
                  <td className="tabular-nums">{r.dids_evaluated}</td>
                  <td className="tabular-nums">{r.proposals}</td>
                  <td className="tabular-nums">{r.error ? <StatusPill tone="error">Failed</StatusPill> : r.applied}</td>
                </tr>
              ))
            )}
          </DataTable>
        </Panel>
      </div>
    </>
  );
}
