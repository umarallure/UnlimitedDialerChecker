import Link from "next/link";
import { ChevronRight, Flame, Hash, Moon, PhoneOutgoing, X } from "lucide-react";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { LIFECYCLE_LABEL, LIFECYCLE_NOTE, LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatPhone, relative } from "@/lib/time";

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
      "id, e164, state, area_code, lifecycle, lifecycle_since, daily_cap, hourly_cap, manual_hold, manual_hold_reason, attestation, carrier, notes, purchased_at, fcr_registered_at, inbound_route_ok, did_stats_live(calls_today, calls_last_hour, answered_today, short_calls_today, drops_today, last_call_at)",
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
  const events = selected
    ? await supabase.from("did_state_events").select("id, from_state, to_state, reason, actor, dry_run, created_at").eq("did_id", selected.id).order("created_at", { ascending: false }).limit(6)
    : null;

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
            <button className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover active:bg-primary-pressed">
              Apply filter
            </button>
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

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel bodyClassName="p-0">
          <DataTable head={["Number", "Lifecycle", "Calls today / cap", "Answered", "Last call", ""]} minWidth={720}  bare>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>{q || lifecycle ? "No numbers match these filters." : "No numbers yet. Teleinx DIDs will be imported here."}</EmptyRow>
            ) : (
              rows.map((d) => {
                const live = first(d.did_stats_live as LiveStats | LiveStats[]);
                const calls = live?.calls_today ?? 0;
                const usage = d.daily_cap > 0 ? Math.min(calls / d.daily_cap, 1) : 0;
                const isSelected = selected?.id === d.id;
                return (
                  <tr key={d.id} className={`relative ${isSelected ? "bg-surface-alt" : "hover:bg-surface-alt"}`}>
                    <td className={isSelected ? "shadow-[inset_3px_0_0_var(--color-primary)]" : undefined}>
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
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums">
                          {calls} / {d.daily_cap}
                        </span>
                        <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                          <span
                            className={`block h-full rounded-full ${usage >= 1 ? "bg-error" : usage >= 0.8 ? "bg-warning" : "bg-success"}`}
                            style={{ width: `${usage * 100}%` }}
                          />
                        </span>
                      </span>
                    </td>
                    <td className="tabular-nums">
                      {live?.answered_today ?? 0}
                      {calls > 0 && <span className="text-muted"> · {Math.round(((live?.answered_today ?? 0) / calls) * 100)}%</span>}
                    </td>
                    <td className="tabular-nums">{relative(live?.last_call_at ?? null)}</td>
                    <td className="w-10 text-right">
                      <ChevronRight aria-hidden className="ml-auto size-5 text-graphite" />
                    </td>
                  </tr>
                );
              })
            )}
          </DataTable>
        </Panel>

        {selected && (
          <aside className="rounded-lg border border-line bg-surface p-6 xl:sticky xl:top-0">
            {(() => {
              const live = first(selected.did_stats_live as LiveStats | LiveStats[]);
              const rate = live?.calls_today ? Math.round((live.answered_today / live.calls_today) * 100) : null;
              const fields: Array<[string, React.ReactNode]> = [
                ["Lifecycle", <StatusPill key="l" tone={LIFECYCLE_TONE[selected.lifecycle]}>{LIFECYCLE_LABEL[selected.lifecycle]}</StatusPill>],
                ["In state since", formatDate(selected.lifecycle_since)],
                ["Caps", `${selected.daily_cap}/day · ${selected.hourly_cap}/hour`],
                ["Carrier", selected.carrier],
                ["Attestation", selected.attestation ? <StatusPill key="a" tone={selected.attestation === "A" ? "success" : "error"}>{selected.attestation}</StatusPill> : "Unknown"],
                ["Free Caller Registry", selected.fcr_registered_at ? formatDate(selected.fcr_registered_at) : "Not registered"],
                ["Callback route", selected.inbound_route_ok ? "Verified" : "Not verified"],
              ];
              const eventRows = events?.data ?? [];
              return (
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-title-md font-bold text-ink tabular-nums">{formatPhone(selected.e164)}</h2>
                    <p className="text-caption text-muted">
                      {selected.state ?? "Unknown state"} · Area code {selected.area_code}
                    </p>
                  </div>

                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-caption">
                    {fields.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="grid grid-cols-3 gap-2 border-y border-line py-4 text-center">
                    <Stat label="Calls" value={live?.calls_today ?? 0} />
                    <Stat label="Answer" value={rate === null ? "—" : `${rate}%`} />
                    <Stat label="Short" value={live?.short_calls_today ?? 0} />
                  </div>

                  <div className="flex flex-col gap-4">
                    <h3 className="text-title-sm font-bold text-ink">Lifecycle timeline</h3>
                    {eventRows.length === 0 ? (
                      <p className="text-caption text-muted">No state changes yet. {LIFECYCLE_NOTE[selected.lifecycle]}.</p>
                    ) : (
                      <ol className="flex flex-col">
                        {eventRows.map((e, i) => (
                          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
                            {i < eventRows.length - 1 && <span aria-hidden className="absolute top-6 bottom-0 left-[9px] w-px bg-line" />}
                            <span aria-hidden className={`mt-0.5 size-[19px] shrink-0 rounded-full border-2 ${e.dry_run ? "border-line-strong bg-surface" : "border-success bg-success"}`} />
                            <span className="flex flex-col gap-0.5">
                              <span className="text-legal text-muted">{formatDateTime(e.created_at)}</span>
                              <span className="text-caption font-semibold text-ink">
                                {LIFECYCLE_LABEL[e.from_state ?? ""] ?? "Added"} → {LIFECYCLE_LABEL[e.to_state]}
                                {e.dry_run ? " (dry run)" : ""}
                              </span>
                              <span className="text-caption text-muted">{e.reason}</span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  <div className="rounded-lg bg-surface-alt p-4">
                    <p className="text-caption text-graphite">Next step</p>
                    <p className="mt-1 text-caption font-semibold text-ink">{nextStep(selected)}</p>
                    {selected.notes && <p className="mt-2 text-legal text-muted">{selected.notes}</p>}
                  </div>
                </div>
              );
            })()}
          </aside>
        )}
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

function nextStep(d: { lifecycle: string; fcr_registered_at: string | null; inbound_route_ok: boolean; attestation: string | null; manual_hold: boolean }) {
  if (d.manual_hold) return "Held manually. Release it when the issue is resolved.";
  if (d.lifecycle === "NEW") {
    if (!d.fcr_registered_at) return "Register on Free Caller Registry before first use.";
    if (!d.inbound_route_ok) return "Verify callbacks reach the IVR.";
    return "Waiting for 7 days of aging and a clean reputation scan.";
  }
  if (d.attestation && d.attestation !== "A") return "Not A-attested. Replace with a Teleinx DID.";
  if (d.lifecycle === "COOLING") return "Resting. Scan reputation before it returns to warm-up.";
  if (d.lifecycle === "RETIRED") return "Keep routing callbacks for 90 days, then release.";
  return "Healthy. Keep usage under the daily cap.";
}
