import Link from "next/link";
import { AlertOctagon, AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Panel, StatusPill } from "@/components/ui";
import { alertKindLabel, severityTone } from "@/lib/alerts";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPhone, hoursAgoIso, relative } from "@/lib/time";
import { ResolveButton, RunChecksButton } from "./alert-actions";

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  await requireAdmin();
  const params = await searchParams;
  const view = params.view === "resolved" ? "resolved" : "open";
  const supabase = await createClient();

  let listQuery = supabase
    .from("alerts")
    .select("id, kind, severity, message, did_id, created_at, last_seen_at, emailed_at, resolved_at, resolved_by, dids(e164)")
    .limit(200);
  listQuery =
    view === "open"
      ? listQuery.is("resolved_at", null).order("severity", { ascending: false }).order("created_at", { ascending: false })
      : listQuery.not("resolved_at", "is", null).order("resolved_at", { ascending: false });

  const [list, openAll, resolved24, settings, lastEmail] = await Promise.all([
    listQuery,
    supabase.from("alerts").select("severity").is("resolved_at", null),
    supabase.from("alerts").select("id", { count: "exact", head: true }).gte("resolved_at", hoursAgoIso(24)),
    supabase.from("notification_settings").select("recipients, immediate_enabled, digest_enabled, digest_hour_et, last_run_at, last_error").maybeSingle(),
    supabase.from("notification_log").select("kind, status, subject, sent_at").order("sent_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const open = openAll.data ?? [];
  const critical = open.filter((a) => a.severity === "critical").length;
  const warnings = open.filter((a) => a.severity === "warning").length;
  const s = settings.data;
  const emailReady = s && !s.last_error;
  const rows = list.data ?? [];
  const hour = s ? new Date(2000, 0, 1, s.digest_hour_et).toLocaleTimeString("en-US", { hour: "numeric" }) : "8 AM";

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Problems found by the health checks, which run every 15 minutes. Alerts close on their own once a number recovers."
        action={<RunChecksButton />}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Critical" value={critical} note={critical ? "Emailed immediately" : "None open"} noteTone={critical ? "error" : "muted"} icon={<AlertOctagon className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Warnings" value={warnings} note="Included in the daily summary" noteTone={warnings ? "warning" : "muted"} icon={<AlertTriangle className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Resolved, last 24 h" value={resolved24.count ?? 0} icon={<CheckCircle2 className="size-5" strokeWidth={1.75} />} />
        <KpiCard
          label="Email"
          value={emailReady ? "On" : "Setup"}
          note={s?.last_run_at ? `Last check ${relative(s.last_run_at)}` : "Not run yet"}
          noteTone={emailReady ? "success" : "warning"}
          icon={<Mail className="size-5" strokeWidth={1.75} />}
        />
      </div>

      {s?.last_error && (
        <Alert tone="warning">
          Emails aren’t sending: {s.last_error}. Alerts still appear here. Add the Resend key and sender address in Supabase → Edge Functions → Secrets.
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title={view === "open" ? "Open alerts" : "Resolved alerts"}
          action={
            <nav aria-label="Alert view" className="flex gap-2">
              {(["open", "resolved"] as const).map((v) => (
                <Link
                  key={v}
                  href={v === "open" ? "/alerts" : "/alerts?view=resolved"}
                  aria-current={view === v ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full border px-4 text-button ${
                    view === v ? "border-ink bg-ink text-on-dark" : "border-line bg-surface text-graphite hover:border-line-strong"
                  }`}
                >
                  {v === "open" ? `Open ${open.length}` : "Resolved"}
                </Link>
              ))}
            </nav>
          }
          bodyClassName="px-2 pb-2"
        >
          {list.error && <Alert>Couldn’t load alerts: {list.error.message}</Alert>}
          <DataTable head={view === "open" ? ["Severity", "Problem", "Number", "Opened", "Emailed", ""] : ["Severity", "Problem", "Number", "Opened", "Resolved", "By"]} minWidth={860} bare>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>{view === "open" ? "No open alerts. Every number is within its limits." : "No resolved alerts yet."}</EmptyRow>
            ) : (
              rows.map((a) => {
                const did = Array.isArray(a.dids) ? a.dids[0] : a.dids;
                return (
                  <tr key={a.id}>
                    <td>
                      <StatusPill tone={severityTone(a.severity)}>{a.severity === "critical" ? "Critical" : "Warning"}</StatusPill>
                    </td>
                    <td className="max-w-[420px]">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold text-ink">{alertKindLabel(a.kind)}</span>
                        <span className="text-caption text-graphite">{a.message}</span>
                      </span>
                    </td>
                    <td className="tabular-nums">
                      {a.did_id && did ? (
                        <Link href={`/numbers/${a.did_id}`} className="text-ink underline-offset-2 hover:underline">
                          {formatPhone(did.e164)}
                        </Link>
                      ) : (
                        "Pool"
                      )}
                    </td>
                    <td className="tabular-nums">
                      <span className="flex flex-col">
                        <span>{formatDateTime(a.created_at)}</span>
                        {view === "open" && <span className="text-legal text-muted">checked {relative(a.last_seen_at)}</span>}
                      </span>
                    </td>
                    {view === "open" ? (
                      <>
                        <td>{a.severity === "critical" ? (a.emailed_at ? relative(a.emailed_at) : "Pending") : "In summary"}</td>
                        <td className="text-right">
                          <ResolveButton id={a.id} label={alertKindLabel(a.kind)} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="tabular-nums">{formatDateTime(a.resolved_at)}</td>
                        <td>{a.resolved_by === "auto" ? "Recovered" : a.resolved_by}</td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </DataTable>
        </Panel>

        <Panel title="Email notifications" bodyClassName="flex flex-col gap-4 px-6 pb-6 text-caption">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
            <dt className="text-muted">Recipients</dt>
            <dd className="break-words text-ink">{s?.recipients?.join(", ") ?? "—"}</dd>
            <dt className="text-muted">Immediate</dt>
            <dd className="text-ink">{s?.immediate_enabled ? "Critical alerts, within 15 minutes" : "Off"}</dd>
            <dt className="text-muted">Daily summary</dt>
            <dd className="text-ink">{s?.digest_enabled ? `${hour} Eastern` : "Off"}</dd>
            <dt className="text-muted">Last email</dt>
            <dd className="text-ink">{lastEmail.data ? `${lastEmail.data.kind === "digest" ? "Summary" : "Alert"} · ${lastEmail.data.status} · ${relative(lastEmail.data.sent_at)}` : "None yet"}</dd>
          </dl>
          <div className="rounded-lg bg-surface-alt p-4 text-graphite">
            <p className="font-semibold text-ink">What triggers an alert</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
              <li>Answer rate under 8% over 3 days</li>
              <li>More than 30% of answered calls under 6 seconds</li>
              <li>Drops over 3%, or 5+ carrier 608 rejections</li>
              <li>Any spam label from a reputation scan</li>
              <li>Dialer not synced for 20 minutes</li>
            </ul>
          </div>
        </Panel>
      </div>
    </>
  );
}
