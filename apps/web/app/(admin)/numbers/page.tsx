import Link from "next/link";
import { ChevronRight, Flame, Hash, Moon, PhoneOutgoing, Upload, X } from "lucide-react";
import { BulkBar, NumberSelection, RowCheckbox } from "@/components/numbers/bulk-selection";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Panel, PrimaryLink, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { nextStep, setupProgress } from "@/lib/number-actions";
import { LIFECYCLE_LABEL, LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatPhone, relative } from "@/lib/time";

const LIFECYCLES = ["NEW", "WARMING", "ACTIVE", "COOLING", "RETIRED"] as const;
type Lifecycle = (typeof LIFECYCLES)[number];

type LiveStats = { calls_today: number; calls_last_hour: number; answered_today: number; short_calls_today: number; drops_today: number; last_call_at: string | null };

function first<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

export default async function NumbersPage({ searchParams }: PageProps<"/numbers">) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const lifecycle = typeof params.lifecycle === "string" && (LIFECYCLES as readonly string[]).includes(params.lifecycle) ? (params.lifecycle as Lifecycle) : null;
  const selectedId = typeof params.id === "string" ? params.id : null;

  const supabase = await createClient();
  let query = supabase
    .from("dids")
    .select(
      "id, e164, state, area_code, lifecycle, lifecycle_since, daily_cap, hourly_cap, manual_hold, manual_hold_reason, attestation, carrier, fcr_registered_at, inbound_route_ok, cnam, cap_override, did_stats_live(calls_today, calls_last_hour, answered_today, short_calls_today, drops_today, last_call_at)",
    )
    .order("state", { nullsFirst: false })
    .order("e164");
  if (lifecycle) query = query.eq("lifecycle", lifecycle);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const stateCode = /^[a-z]{2}$/i.test(q) ? q.toUpperCase() : null;
    const ors = [digits ? `e164.ilike.%${digits}%` : null, stateCode ? `state.eq.${stateCode}` : null].filter(Boolean);
    if (ors.length) query = query.or(ors.join(","));
  }

  const [{ data: dids, error }, allDids] = await Promise.all([query, supabase.from("dids").select("lifecycle, manual_hold, did_stats_live(calls_today)")]);

  const rows = dids ?? [];
  const pool = allDids.data ?? [];
  const countOf = (l: Lifecycle) => pool.filter((d) => d.lifecycle === l).length;
  const callsToday = pool.reduce((n, d) => n + (first(d.did_stats_live as LiveStats | LiveStats[])?.calls_today ?? 0), 0);
  const held = pool.filter((d) => d.manual_hold).length;

  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];
  const alertCount = selected
    ? ((await supabase.from("alerts").select("id", { count: "exact", head: true }).eq("did_id", selected.id).is("resolved_at", null)).count ?? 0)
    : 0;

  const hrefWith = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    const merged = { q: q || null, lifecycle, id: selectedId, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/numbers?${s}` : "/numbers";
  };

  return (
    <>
      <PageHeader
        title="Numbers"
        description="Your caller-ID pool with today’s usage against each number’s cap. Keep every number healthy."
        action={
          <form action="/numbers" method="get" className="flex flex-wrap items-center gap-3">
            {q && <input type="hidden" name="q" value={q} />}
            <label className="sr-only" htmlFor="lifecycle-filter">
              Lifecycle
            </label>
            <select
              id="lifecycle-filter"
              name="lifecycle"
              defaultValue={lifecycle ?? ""}
              className="h-11 rounded-md border border-line bg-surface pr-9 pl-4 text-caption text-ink focus:border-line-strong focus:outline-none"
            >
              <option value="">All lifecycles</option>
              {LIFECYCLES.map((l) => (
                <option key={l} value={l}>
                  {LIFECYCLE_LABEL[l]}
                </option>
              ))}
            </select>
            <button className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong">
              Apply filter
            </button>
            <PrimaryLink href="/numbers/import">
              <Upload aria-hidden className="size-4" /> Import numbers
            </PrimaryLink>
          </form>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active" value={countOf("ACTIVE")} note={`${countOf("WARMING")} warming up`} noteTone="success" icon={<Hash className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Aging" value={countOf("NEW")} note="Not dialing yet" icon={<Flame className="size-5" strokeWidth={1.75} />} />
        <KpiCard
          label="Resting or held"
          value={countOf("COOLING") + held}
          note={`${countOf("RETIRED")} retired`}
          noteTone={countOf("COOLING") + held ? "warning" : "muted"}
          icon={<Moon className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard label="Calls today" value={callsToday.toLocaleString()} note="Across the whole pool" icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />} />
      </div>

      {error && <Alert>Couldn’t load numbers: {error.message}</Alert>}

      {(q || lifecycle) && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-graphite">
          Showing {rows.length} number{rows.length === 1 ? "" : "s"}
          {q && <StatusPill>Search: {q}</StatusPill>}
          {lifecycle && <StatusPill tone={LIFECYCLE_TONE[lifecycle]}>{LIFECYCLE_LABEL[lifecycle]}</StatusPill>}
          <Link href="/numbers" className="inline-flex min-h-11 items-center gap-1 px-2 text-ink hover:underline">
            <X aria-hidden className="size-4" /> Clear
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel bodyClassName="p-0">
          <NumberSelection ids={rows.map((r) => r.id)}>
            <BulkBar />
            <DataTable head={["", "Number", "Lifecycle", "Setup", "Calls today / cap", "Answered", "Last call", ""]} minWidth={860} bare>
              {rows.length === 0 ? (
                <EmptyRow colSpan={8}>{q || lifecycle ? "No numbers match these filters." : "No numbers yet. Use Import numbers to add your Teleinx DIDs."}</EmptyRow>
              ) : (
                rows.map((d) => {
                  const live = first(d.did_stats_live as LiveStats | LiveStats[]);
                  const calls = live?.calls_today ?? 0;
                  const cap = d.cap_override ?? d.daily_cap;
                  const usage = cap > 0 ? Math.min(calls / cap, 1) : 0;
                  const isSelected = selected?.id === d.id;
                  const setup = setupProgress(d);
                  return (
                    <tr key={d.id} className={`relative ${isSelected ? "bg-surface-alt" : "hover:bg-surface-alt"}`}>
                      <td className={`w-12 !px-2 ${isSelected ? "shadow-[inset_3px_0_0_var(--color-primary)]" : ""}`}>
                        <RowCheckbox id={d.id} label={formatPhone(d.e164)} />
                      </td>
                      <td>
                        <Link href={hrefWith({ id: d.id })} className="flex flex-col after:absolute after:inset-0" aria-current={isSelected ? "true" : undefined}>
                          <span className="font-semibold text-ink tabular-nums">{formatPhone(d.e164)}</span>
                          <span className="text-legal text-muted">
                            {d.state ?? "Unknown state"} · {d.area_code}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <span className="flex flex-wrap gap-1">
                          <StatusPill tone={LIFECYCLE_TONE[d.lifecycle]}>{LIFECYCLE_LABEL[d.lifecycle]}</StatusPill>
                          {d.manual_hold && <StatusPill tone="error">Held</StatusPill>}
                        </span>
                      </td>
                      <td>
                        <StatusPill tone={setup.done === setup.total ? "success" : "neutral"}>
                          {setup.done}/{setup.total}
                        </StatusPill>
                      </td>
                      <td>
                        <span className="flex items-center gap-3">
                          <span className="tabular-nums">
                            {calls} / {cap}
                            {d.cap_override !== null && <span className="text-muted">*</span>}
                          </span>
                          <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                            <span className={`block h-full rounded-full ${usage >= 1 ? "bg-error" : usage >= 0.8 ? "bg-warning" : "bg-success"}`} style={{ width: `${usage * 100}%` }} />
                          </span>
                        </span>
                      </td>
                      <td className="tabular-nums">
                        {live?.answered_today ?? 0}
                        {calls > 0 && <span className="text-muted"> · {Math.round(((live?.answered_today ?? 0) / calls) * 100)}%</span>}
                      </td>
                      <td className="tabular-nums">{relative(live?.last_call_at ?? null)}</td>
                      <td className="w-12 !px-2 text-right">
                        <Link
                          href={`/numbers/${d.id}`}
                          aria-label={`Manage ${formatPhone(d.e164)}`}
                          className="relative z-10 ml-auto flex size-11 items-center justify-center rounded-full text-graphite hover:bg-surface hover:text-ink"
                        >
                          <ChevronRight aria-hidden className="size-5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </DataTable>
          </NumberSelection>
        </Panel>

        {selected &&
          (() => {
            const live = first(selected.did_stats_live as LiveStats | LiveStats[]);
            const rate = live?.calls_today ? Math.round((live.answered_today / live.calls_today) * 100) : null;
            const setup = setupProgress(selected);
            return (
              <aside className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 xl:sticky xl:top-0">
                <div className="flex flex-col gap-2">
                  <h2 className="text-title-md font-bold text-ink tabular-nums">{formatPhone(selected.e164)}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={LIFECYCLE_TONE[selected.lifecycle]}>{LIFECYCLE_LABEL[selected.lifecycle]}</StatusPill>
                    {selected.manual_hold && <StatusPill tone="error">Held</StatusPill>}
                    <span className="text-caption text-muted">
                      {selected.state ?? "Unknown state"} · since {formatDate(selected.lifecycle_since)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 border-y border-line py-4 text-center">
                  <Stat label="Calls" value={live?.calls_today ?? 0} />
                  <Stat label="Answer" value={rate === null ? "—" : `${rate}%`} />
                  <Stat label="Short" value={live?.short_calls_today ?? 0} />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-caption">
                    <span className="text-graphite">Setup</span>
                    <span className="font-semibold text-ink tabular-nums">
                      {setup.done} of {setup.total}
                    </span>
                  </div>
                  <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-line">
                    <span className={`block h-full rounded-full ${setup.done === setup.total ? "bg-success" : "bg-graphite"}`} style={{ width: `${(setup.done / setup.total) * 100}%` }} />
                  </span>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-caption">
                  <dt className="text-muted">Daily cap</dt>
                  <dd className="text-ink">
                    {selected.cap_override ?? selected.daily_cap}
                    {selected.cap_override !== null ? " (override)" : ""}
                  </dd>
                  <dt className="text-muted">Open alerts</dt>
                  <dd className={alertCount ? "font-semibold text-error" : "text-ink"}>{alertCount}</dd>
                </dl>

                <p className="rounded-lg bg-surface-alt p-3 text-caption text-graphite">{nextStep(selected)}</p>

                <div className="flex flex-col gap-2">
                  <Link href={`/numbers/${selected.id}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-button text-on-dark hover:bg-graphite">
                    Manage number
                  </Link>
                  {setup.done < setup.total && (
                    <Link
                      href={`/numbers/${selected.id}?tab=setup`}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong"
                    >
                      Complete setup
                    </Link>
                  )}
                </div>
              </aside>
            );
          })()}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-title-sm font-bold tabular-nums text-ink">{value}</span>
      <span className="text-legal text-muted">{label}</span>
    </div>
  );
}
