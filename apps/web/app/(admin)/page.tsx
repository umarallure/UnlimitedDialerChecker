import Link from "next/link";
import { AlertTriangle, ChevronRight, Hash, PhoneOutgoing, RadioTower, ShieldCheck, Target } from "lucide-react";
import { ArrowLink, DataTable, EmptyRow, KpiCard, PageHeader, Panel, PrimaryLink, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { callTone, LIFECYCLE_LABEL, LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";
import { dialerDay, formatDuration, formatPhone, formatTime, greeting, relative } from "@/lib/time";

function delta(today: number, yesterday: number, unit = "") {
  const d = today - yesterday;
  if (d === 0) return `No change from yesterday`;
  return `${d > 0 ? "+" : ""}${d}${unit} from yesterday`;
}

export default async function OverviewPage() {
  const admin = await requireAdmin();
  const supabase = await createClient();
  const today = dialerDay(0);
  const yesterday = dialerDay(-1);

  const [daily, dids, agents, alerts, recent, dialers] = await Promise.all([
    supabase.from("did_stats_daily").select("day, calls, answered").in("day", [today, yesterday]),
    supabase.from("dids").select("lifecycle, manual_hold"),
    supabase.from("agents_live").select("status"),
    supabase.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null),
    supabase
      .from("calls_recent")
      .select("uniqueid, call_date, outbound_cid, lead_phone_last4, agent_user, status, length_sec, campaign_id")
      .order("call_date", { ascending: false })
      .limit(6),
    supabase.from("dialers").select("name, last_heartbeat_at, agent_version").order("last_heartbeat_at", { ascending: false }).limit(1),
  ]);

  const sum = (day: string, key: "calls" | "answered") =>
    (daily.data ?? []).filter((r) => r.day === day).reduce((n, r) => n + (r[key] ?? 0), 0);
  const callsToday = sum(today, "calls");
  const callsYesterday = sum(yesterday, "calls");
  const rateToday = callsToday ? Math.round((sum(today, "answered") / callsToday) * 100) : 0;
  const rateYesterday = callsYesterday ? Math.round((sum(yesterday, "answered") / callsYesterday) * 100) : 0;

  const pool = dids.data ?? [];
  const count = (l: string) => pool.filter((d) => d.lifecycle === l).length;
  const inRotation = count("ACTIVE") + count("WARMING");
  const held = pool.filter((d) => d.manual_hold).length;
  const needsAttention = count("COOLING") + held;

  const agentRows = agents.data ?? [];
  const ready = agentRows.filter((a) => a.status === "READY").length;
  const openAlerts = alerts.count ?? 0;
  const dialer = dialers.data?.[0];
  const name = admin.email.split("@")[0];

  return (
    <>
      <PageHeader
        eyebrow={`${greeting()}, ${name}`}
        title="Overview"
        description="Stay on top of caller-ID health, live agents, and dialer activity."
        action={<PrimaryLink href="/numbers">Review numbers</PrimaryLink>}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Calls today"
          value={callsToday.toLocaleString()}
          note={delta(callsToday, callsYesterday)}
          icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Answer rate"
          value={`${rateToday}%`}
          note={callsToday ? delta(rateToday, rateYesterday, " pts") : "No calls yet today"}
          noteTone={callsToday && rateToday < 8 ? "error" : "muted"}
          icon={<Target className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Numbers in rotation"
          value={inRotation}
          note={`${count("NEW")} aging · ${needsAttention} resting or held`}
          icon={<Hash className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Open alerts"
          value={openAlerts}
          note={openAlerts ? "Needs review" : "Nothing needs attention"}
          noteTone={openAlerts ? "error" : "muted"}
          icon={<AlertTriangle className="size-5" strokeWidth={1.75} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Panel
          title="Recent calls"
          subtitle="Latest outbound attempts synced from the dialer."
          action={<ArrowLink href="/calls">View all</ArrowLink>}
          bodyClassName="px-2 pb-2"
        >
          <DataTable head={["Caller ID", "Lead", "Status", "Agent", "Duration", "Time"]} minWidth={640} bare>
            {(recent.data ?? []).length === 0 ? (
              <EmptyRow colSpan={6}>No calls synced yet.</EmptyRow>
            ) : (
              (recent.data ?? []).map((c) => (
                <tr key={c.uniqueid}>
                  <td className="font-medium !text-ink tabular-nums">{formatPhone(c.outbound_cid)}</td>
                  <td className="tabular-nums">{c.lead_phone_last4 ? `•••• ${c.lead_phone_last4}` : "—"}</td>
                  <td>{c.status ? <StatusPill tone={callTone(c.status)}>{c.status}</StatusPill> : "—"}</td>
                  <td>{c.agent_user ?? "—"}</td>
                  <td className="tabular-nums">{formatDuration(c.length_sec)}</td>
                  <td className="tabular-nums">{formatTime(c.call_date)}</td>
                </tr>
              ))
            )}
          </DataTable>
        </Panel>

        <Panel title="Today’s focus" subtitle="What needs attention across the pool." bodyClassName="flex flex-col gap-3 px-4 pb-4">
          <FocusItem
            href="/"
            icon={<RadioTower className="size-5" strokeWidth={1.75} />}
            eyebrow={dialer ? "Dialer sync" : "Set up"}
            title={dialer ? `Dialer ${dialer.name}` : "Connect the dialer agent"}
            body={dialer ? `Last update ${relative(dialer.last_heartbeat_at)} · agent v${dialer.agent_version ?? "?"}` : "Start the service on the VICIdial server."}
            highlight={!dialer}
          />
          <FocusItem
            href="/numbers?lifecycle=COOLING"
            icon={<ShieldCheck className="size-5" strokeWidth={1.75} />}
            eyebrow="Number health"
            title={`${needsAttention} number${needsAttention === 1 ? "" : "s"} resting or held`}
            body={`${pool.length} in the pool · ${count("RETIRED")} retired`}
          />
          <FocusItem
            href="/agents"
            icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />}
            eyebrow="Agents"
            title={`${agentRows.length} logged in, ${ready} ready`}
            body="Live states update every few seconds."
          />
          <div className="flex flex-wrap gap-2 px-2 pt-2">
            {(["NEW", "WARMING", "ACTIVE", "COOLING", "RETIRED"] as const).map((l) => (
              <StatusPill key={l} tone={LIFECYCLE_TONE[l]}>
                {LIFECYCLE_LABEL[l]} {count(l)}
              </StatusPill>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

function FocusItem({
  href,
  icon,
  eyebrow,
  title,
  body,
  highlight = false,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-lg border p-4 transition-shadow hover:shadow-card-hover ${
        highlight ? "border-line bg-surface-alt" : "border-transparent hover:border-line"
      }`}
    >
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-alt text-graphite group-hover:bg-surface">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-label uppercase ${highlight ? "text-primary" : "text-muted"}`}>{eyebrow}</span>
        <span className="text-body font-semibold text-ink">{title}</span>
        <span className="text-caption text-muted">{body}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted group-hover:text-ink" />
    </Link>
  );
}
