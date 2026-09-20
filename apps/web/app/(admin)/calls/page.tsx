import { Clock, PhoneIncoming, PhoneOutgoing, Play, Timer } from "lucide-react";
import { CallFiltersBar } from "@/components/calls/filters";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Pagination, Panel, StatusPill } from "@/components/ui";
import { ANSWERED_STATUSES, OUTCOMES, RANGES, callsHref, hasFilters, parseFilters, searchClause } from "@/lib/calls";
import { requireAdmin } from "@/lib/dal";
import { callTone } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatDuration, formatPhone, hoursAgoIso } from "@/lib/time";

const COLUMNS =
  "uniqueid, call_date, outbound_cid, lead_phone_last4, campaign_id, agent_user, status, length_sec, sip_code, call_type, recording_sec, recording_file, recording_url";
const ANSWERED = new Set(ANSWERED_STATUSES);

export default async function CallsPage({ searchParams }: PageProps<"/calls">) {
  await requireAdmin();
  const filters = parseFilters(await searchParams);
  const supabase = await createClient();

  // The feed honours the filters; the KPI row always describes the last 24 hours of the whole pool.
  let feed = supabase.from("calls_recent").select(COLUMNS, { count: "exact" }).order("call_date", { ascending: false });

  const hours = RANGES[filters.range].hours;
  if (hours) feed = feed.gte("call_date", hoursAgoIso(hours));
  if (filters.outcome) feed = feed.in("status", OUTCOMES[filters.outcome].statuses);
  const search = searchClause(filters.q);
  if (search) feed = feed.or(search);

  const from = (filters.page - 1) * filters.size;
  const [{ data: calls, count, error }, last24] = await Promise.all([
    feed.range(from, from + filters.size - 1),
    supabase.from("calls_recent").select("status, length_sec").gte("call_date", hoursAgoIso(24)),
  ]);

  const total = count ?? 0;
  const rows = calls ?? [];
  const day = last24.data ?? [];
  const answered = day.filter((c) => c.status && ANSWERED.has(c.status));
  const talk = answered.reduce((n, c) => n + (c.length_sec ?? 0), 0);
  const short = answered.filter((c) => c.length_sec !== null && c.length_sec < 6).length;

  return (
    <>
      <PageHeader title="Calls" description="Outbound attempts from the last 7 days, with the caller ID each call used. Customer numbers show the last 4 digits only." />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Calls, last 24 h" value={day.length.toLocaleString()} icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Answered" value={answered.length.toLocaleString()} note={day.length ? `${Math.round((answered.length / day.length) * 100)}% of calls` : undefined} icon={<PhoneIncoming className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Avg talk time" value={answered.length ? formatDuration(Math.round(talk / answered.length)) : "—"} icon={<Timer className="size-5" strokeWidth={1.75} />} />
        <KpiCard
          label="Short calls"
          value={short}
          note={answered.length ? `${Math.round((short / answered.length) * 100)}% under 6 seconds` : undefined}
          noteTone={answered.length && short / answered.length > 0.2 ? "error" : "muted"}
          icon={<Clock className="size-5" strokeWidth={1.75} />}
        />
      </div>

      {error && <Alert>Couldn’t load calls: {error.message}</Alert>}

      <Panel title="Call feed" subtitle={`${RANGES[filters.range].label}, newest first.`} bodyClassName="p-0">
        <CallFiltersBar filters={filters} showing={total} />
        <div className="px-2">
          <DataTable head={["Time", "Caller ID", "Lead", "Status", "Agent", "Campaign", "Duration", "SIP", "Recording"]} minWidth={980} bare>
            {rows.length === 0 ? (
              <EmptyRow colSpan={9}>
                {hasFilters(filters) ? "No calls match these filters." : "No calls synced yet. The dialer agent syncs this feed every 15 minutes."}
              </EmptyRow>
            ) : (
              rows.map((c) => (
                <tr key={c.uniqueid}>
                  <td className="tabular-nums">{formatDateTime(c.call_date)}</td>
                  <td className="font-semibold !text-ink tabular-nums">{formatPhone(c.outbound_cid)}</td>
                  <td className="tabular-nums">{c.lead_phone_last4 ? `•••• ${c.lead_phone_last4}` : "—"}</td>
                  <td>{c.status ? <StatusPill tone={callTone(c.status)}>{c.status}</StatusPill> : "—"}</td>
                  <td>{c.agent_user ?? "—"}</td>
                  <td>{c.campaign_id ?? "—"}</td>
                  <td className="tabular-nums">{formatDuration(c.length_sec)}</td>
                  <td className="tabular-nums">{c.sip_code ?? "—"}</td>
                  <td className="tabular-nums">
                    {c.recording_file ? (
                      c.recording_url ? (
                        <a href={c.recording_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink hover:underline" title={c.recording_file}>
                          <Play aria-hidden className="size-3.5" /> {formatDuration(c.recording_sec)}
                        </a>
                      ) : (
                        <span title={c.recording_file}>{formatDuration(c.recording_sec)}</span>
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </DataTable>
        </div>
        <Pagination page={filters.page} pageSize={filters.size} total={total} unit="calls" hrefFor={(page) => callsHref(filters, { page })} />
      </Panel>
    </>
  );
}
