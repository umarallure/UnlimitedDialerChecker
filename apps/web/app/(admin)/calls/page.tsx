import { Clock, PhoneIncoming, PhoneOutgoing, Timer } from "lucide-react";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { callTone } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatDuration, formatPhone, hoursAgoIso } from "@/lib/time";

const ANSWERED_HINT = new Set(["SALE", "CALLBK", "CBHOLD", "NI", "DEC", "DNC", "DROP", "PDROP", "NP", "QCFAIL"]);

export default async function CallsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const since = hoursAgoIso(24);

  const [{ data: calls, error }, last24] = await Promise.all([
    supabase
      .from("calls_recent")
      .select("uniqueid, call_date, outbound_cid, lead_phone_last4, campaign_id, agent_user, status, length_sec, sip_code, call_type")
      .order("call_date", { ascending: false })
      .limit(100),
    supabase.from("calls_recent").select("status, length_sec").gte("call_date", since),
  ]);

  const day = last24.data ?? [];
  const answered = day.filter((c) => c.status && ANSWERED_HINT.has(c.status));
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

      <Panel title="Call feed" subtitle="Latest 100 calls, newest first." bodyClassName="px-2 pb-2">
        <DataTable head={["Time", "Caller ID", "Lead", "Status", "Agent", "Campaign", "Duration", "SIP"]} minWidth={860} bare>
          {(calls ?? []).length === 0 ? (
            <EmptyRow colSpan={8}>No calls synced yet. The dialer agent fills this feed every minute.</EmptyRow>
          ) : (
            (calls ?? []).map((c) => (
              <tr key={c.uniqueid}>
                <td className="tabular-nums">{formatDateTime(c.call_date)}</td>
                <td className="font-semibold !text-ink tabular-nums">{formatPhone(c.outbound_cid)}</td>
                <td className="tabular-nums">{c.lead_phone_last4 ? `•••• ${c.lead_phone_last4}` : "—"}</td>
                <td>{c.status ? <StatusPill tone={callTone(c.status)}>{c.status}</StatusPill> : "—"}</td>
                <td>{c.agent_user ?? "—"}</td>
                <td>{c.campaign_id ?? "—"}</td>
                <td className="tabular-nums">{formatDuration(c.length_sec)}</td>
                <td className="tabular-nums">{c.sip_code ?? "—"}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Panel>
    </>
  );
}
