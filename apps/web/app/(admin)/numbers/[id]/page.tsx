import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, PhoneIncoming, PhoneOutgoing, Scissors } from "lucide-react";
import { DetailsForm, LifecycleActions, SetupSteps, type PanelDid } from "@/components/numbers/number-actions";
import { KpiCard, Panel, StatusPill } from "@/components/ui";
import { alertKindLabel, severityTone } from "@/lib/alerts";
import { requireAdmin } from "@/lib/dal";
import { nextStep, setupProgress } from "@/lib/number-actions";
import { LIFECYCLE_LABEL, LIFECYCLE_NOTE, LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPhone, relative } from "@/lib/time";

const TABS = ["overview", "setup", "actions", "history"] as const;
type Tab = (typeof TABS)[number];

type LiveStats = { calls_today: number; calls_last_hour: number; answered_today: number; short_calls_today: number; drops_today: number; last_call_at: string | null };

export default async function NumberDetailPage({ params, searchParams }: PageProps<"/numbers/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "overview";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: did }, events, alerts] = await Promise.all([
    supabase
      .from("dids")
      .select(
        "id, e164, state, area_code, carrier, lifecycle, lifecycle_since, warmup_week, daily_cap, hourly_cap, cap_override, manual_hold, manual_hold_reason, attestation, cnam, notes, purchased_at, mrc_cents, fcr_registered_at, inbound_route_ok, created_at, did_stats_live(calls_today, calls_last_hour, answered_today, short_calls_today, drops_today, last_call_at)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("did_state_events").select("id, from_state, to_state, reason, actor, dry_run, created_at").eq("did_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("alerts").select("id, kind, severity, message, created_at").eq("did_id", id).is("resolved_at", null).order("severity", { ascending: false }),
  ]);
  if (!did) notFound();

  const live = (Array.isArray(did.did_stats_live) ? did.did_stats_live[0] : did.did_stats_live) as LiveStats | undefined;
  const calls = live?.calls_today ?? 0;
  const answered = live?.answered_today ?? 0;
  const setup = setupProgress(did);
  const openAlerts = alerts.data ?? [];
  const eventRows = events.data ?? [];
  const panelDid: PanelDid = {
    id: did.id,
    lifecycle: did.lifecycle,
    manual_hold: did.manual_hold,
    manual_hold_reason: did.manual_hold_reason,
    fcr_registered_at: did.fcr_registered_at,
    inbound_route_ok: did.inbound_route_ok,
    attestation: did.attestation,
    cnam: did.cnam,
    notes: did.notes,
    cap_override: did.cap_override,
    daily_cap: did.daily_cap,
  };

  const tabLabel: Record<Tab, string> = {
    overview: "Overview",
    setup: `Setup ${setup.done}/${setup.total}`,
    actions: "Actions",
    history: `History${eventRows.length ? ` ${eventRows.length}` : ""}`,
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link href="/numbers" className="inline-flex min-h-11 items-center gap-2 self-start text-caption text-graphite hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" /> Numbers
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-headline-lg font-bold tabular-nums text-ink">{formatPhone(did.e164)}</h1>
            <div className="flex flex-wrap items-center gap-2 text-caption text-graphite">
              <StatusPill tone={LIFECYCLE_TONE[did.lifecycle]}>{LIFECYCLE_LABEL[did.lifecycle]}</StatusPill>
              {did.manual_hold && <StatusPill tone="error">Held</StatusPill>}
              {openAlerts.length > 0 && <StatusPill tone="error">{openAlerts.length} open alert{openAlerts.length === 1 ? "" : "s"}</StatusPill>}
              <span>
                {did.state ?? "Unknown state"} · Area code {did.area_code} · {did.carrier}
              </span>
            </div>
          </div>
          <p className="max-w-[40ch] text-caption text-muted">{nextStep(did)}</p>
        </div>
      </div>

      <nav aria-label="Number sections" className="-mb-3 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === "overview" ? `/numbers/${did.id}` : `/numbers/${did.id}?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={`relative inline-flex min-h-11 shrink-0 items-center px-4 text-button ${
              tab === t ? "text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted hover:text-ink"
            }`}
          >
            {tabLabel[t]}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Calls today" value={calls} note={`Cap ${did.cap_override ?? did.daily_cap}${did.cap_override !== null ? " (override)" : ""} · ${live?.calls_last_hour ?? 0} last hour`} icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />} />
            <KpiCard label="Answer rate" value={calls ? `${Math.round((answered / calls) * 100)}%` : "—"} note={`${answered} answered`} icon={<PhoneIncoming className="size-5" strokeWidth={1.75} />} />
            <KpiCard label="Short calls" value={live?.short_calls_today ?? 0} note={answered ? `${Math.round(((live?.short_calls_today ?? 0) / answered) * 100)}% of answered` : "Under 6 seconds"} icon={<Scissors className="size-5" strokeWidth={1.75} />} />
            <KpiCard label="Last call" value={live?.last_call_at ? relative(live.last_call_at) : "—"} note={`${live?.drops_today ?? 0} drops today`} icon={<Clock className="size-5" strokeWidth={1.75} />} />
          </div>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            <Panel title="Details" bodyClassName="px-6 pb-6">
              <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-caption">
                {(
                  [
                    ["Lifecycle", `${LIFECYCLE_LABEL[did.lifecycle]} since ${formatDate(did.lifecycle_since)}`],
                    ["What this means", LIFECYCLE_NOTE[did.lifecycle]],
                    ["Caps", `${did.cap_override ?? did.daily_cap}/day · ${did.hourly_cap}/hour`],
                    ["Setup", `${setup.done} of ${setup.total} required steps`],
                    ["Attestation", did.attestation ?? "Unknown"],
                    ["CNAM", did.cnam ?? "Not set"],
                    ["Purchased", did.purchased_at ? formatDate(did.purchased_at) : "—"],
                    ["Monthly cost", did.mrc_cents !== null ? `$${(did.mrc_cents / 100).toFixed(2)}` : "—"],
                    ["Added", formatDate(did.created_at)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              {did.notes && <p className="mt-4 rounded-md bg-surface-alt p-3 text-caption text-graphite">{did.notes}</p>}
            </Panel>

            <Panel title="Open alerts" subtitle={openAlerts.length ? undefined : "Nothing needs attention for this number."} bodyClassName="flex flex-col gap-2 px-6 pb-6">
              {openAlerts.map((a) => (
                <Link key={a.id} href="/alerts" className="flex flex-col gap-1 rounded-lg border border-line p-3 hover:shadow-card-hover">
                  <span className="flex items-center justify-between gap-2">
                    <StatusPill tone={severityTone(a.severity)}>{alertKindLabel(a.kind)}</StatusPill>
                    <span className="text-legal text-muted">{relative(a.created_at)}</span>
                  </span>
                  <span className="text-caption text-graphite">{a.message}</span>
                </Link>
              ))}
            </Panel>
          </div>
        </>
      )}

      {tab === "setup" && (
        <div className="max-w-[860px]">
          <SetupSteps did={panelDid} />
        </div>
      )}

      {tab === "actions" && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Panel title="Lifecycle" subtitle="Changes are recorded in History with your name." bodyClassName="px-6 pb-6">
            <LifecycleActions did={panelDid} setupComplete={setup.done === setup.total} />
          </Panel>
          <Panel title="Details" bodyClassName="px-6 pb-6">
            <DetailsForm did={panelDid} />
          </Panel>
        </div>
      )}

      {tab === "history" && (
        <Panel bodyClassName="p-6">
          {eventRows.length === 0 ? (
            <p className="text-caption text-muted">No changes recorded yet.</p>
          ) : (
            <ol className="flex max-w-[760px] flex-col">
              {eventRows.map((e, i) => (
                <li key={e.id} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < eventRows.length - 1 && <span aria-hidden className="absolute top-6 bottom-0 left-[9px] w-px bg-line" />}
                  <span aria-hidden className={`mt-0.5 size-[19px] shrink-0 rounded-full border-2 ${e.from_state !== e.to_state ? "border-primary bg-primary" : e.dry_run ? "border-line-strong bg-surface" : "border-success bg-success"}`} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-legal text-muted">
                      {formatDateTime(e.created_at)}
                      {e.actor && e.actor !== "agent" ? ` · ${e.actor}` : ""}
                    </span>
                    <span className="text-caption font-semibold text-ink">
                      {e.from_state === e.to_state ? LIFECYCLE_LABEL[e.to_state] : `${LIFECYCLE_LABEL[e.from_state ?? ""] ?? "Added"} → ${LIFECYCLE_LABEL[e.to_state]}`}
                      {e.dry_run ? " (dry run)" : ""}
                    </span>
                    <span className="text-caption text-graphite">{e.reason}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}
    </>
  );
}
