import Link from "next/link";
import { Flame, Hash, Moon, PhoneOutgoing, Upload } from "lucide-react";
import { BulkBar, NumberSelection, RowCheckbox } from "@/components/numbers/bulk-selection";
import { NumberFiltersBar } from "@/components/numbers/filters";
import { RowActions } from "@/components/numbers/row-actions";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Pagination, Panel, PrimaryLink, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { setupProgress } from "@/lib/number-actions";
import { type Lifecycle, hasFilters, numbersHref, parseFilters, searchClause } from "@/lib/numbers-filters";
import { LIFECYCLE_LABEL, LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatPhone, relative } from "@/lib/time";

const COLUMNS =
  "id, e164, state, area_code, lifecycle, lifecycle_since, daily_cap, hourly_cap, manual_hold, manual_hold_reason, attestation, carrier, fcr_registered_at, inbound_route_ok, cnam, cap_override, did_stats_live(calls_today, calls_last_hour, answered_today, short_calls_today, drops_today, last_call_at)";

type LiveStats = { calls_today: number; calls_last_hour: number; answered_today: number; short_calls_today: number; drops_today: number; last_call_at: string | null };

function first<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

export default async function NumbersPage({ searchParams }: PageProps<"/numbers">) {
  await requireAdmin();
  const filters = parseFilters(await searchParams);
  const supabase = await createClient();

  // The table honours the filters; the KPI row always describes the whole pool.
  let query = supabase.from("dids").select(COLUMNS, { count: "exact" }).order("state", { nullsFirst: false }).order("e164");
  if (filters.lifecycle) query = query.eq("lifecycle", filters.lifecycle);
  if (filters.state) query = query.eq("state", filters.state);
  if (filters.hold) query = query.eq("manual_hold", filters.hold === "held");
  const search = searchClause(filters.q);
  if (search) query = query.or(search);

  const from = (filters.page - 1) * filters.size;
  const [{ data: dids, count, error }, allDids] = await Promise.all([
    query.range(from, from + filters.size - 1),
    supabase.from("dids").select("lifecycle, manual_hold, state, did_stats_live(calls_today)"),
  ]);

  const rows = dids ?? [];
  const total = count ?? 0;
  const pool = allDids.data ?? [];
  const states = [...new Set(pool.map((d) => d.state).filter((s): s is string => Boolean(s)))].sort();
  const countOf = (l: Lifecycle) => pool.filter((d) => d.lifecycle === l).length;
  const callsToday = pool.reduce((n, d) => n + (first(d.did_stats_live as LiveStats | LiveStats[])?.calls_today ?? 0), 0);
  const held = pool.filter((d) => d.manual_hold).length;

  return (
    <>
      <PageHeader
        title="Numbers"
        description="Your caller-ID pool with today’s usage against each number’s cap. Keep every number healthy."
        action={
          <PrimaryLink href="/numbers/import">
            <Upload aria-hidden className="size-4" /> Import numbers
          </PrimaryLink>
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

      <Panel bodyClassName="p-0">
        <NumberFiltersBar filters={filters} states={states} showing={total} />
        <NumberSelection ids={rows.map((r) => r.id)}>
          <BulkBar />
          <DataTable head={["", "Number", "Lifecycle", "Setup", "Calls today / cap", "Answered", "Last call", "Actions"]} minWidth={1160} alignRight={[7]} bare>
            {rows.length === 0 ? (
              <EmptyRow colSpan={8}>{hasFilters(filters) ? "No numbers match these filters." : "No numbers yet. Use Import numbers to add your Teleinx DIDs."}</EmptyRow>
            ) : (
              rows.map((d) => {
                const live = first(d.did_stats_live as LiveStats | LiveStats[]);
                const calls = live?.calls_today ?? 0;
                const cap = d.cap_override ?? d.daily_cap;
                const usage = cap > 0 ? Math.min(calls / cap, 1) : 0;
                const setup = setupProgress(d);
                return (
                  <tr key={d.id} className="relative hover:bg-surface-alt">
                    <td className="w-12 !px-2">
                      <RowCheckbox id={d.id} label={formatPhone(d.e164)} />
                    </td>
                    <td>
                      <Link href={`/numbers/${d.id}`} className="flex flex-col after:absolute after:inset-0">
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
                    <td className="text-right">
                      <RowActions id={d.id} label={formatPhone(d.e164)} held={d.manual_hold} retired={d.lifecycle === "RETIRED"} setupComplete={setup.done === setup.total} />
                    </td>
                  </tr>
                );
              })
            )}
          </DataTable>
        </NumberSelection>
        <Pagination page={filters.page} pageSize={filters.size} total={total} unit="numbers" hrefFor={(page) => numbersHref(filters, { page })} />
      </Panel>
    </>
  );
}
