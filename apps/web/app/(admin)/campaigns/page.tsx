import Link from "next/link";
import { Headset, PhoneOutgoing, ShieldAlert, Timer } from "lucide-react";
import {
  TSR_ABANDON_CAP_PCT,
  abandonRate,
  abandonsRemaining,
  callsToRecover,
  complianceLevel,
  type ComplianceLevel,
} from "@udc/policy";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { dialerDay, formatDuration, relative } from "@/lib/time";

const LEVEL_TONE: Record<ComplianceLevel, "success" | "warning" | "error" | "neutral"> = {
  ok: "success",
  at_risk: "warning",
  over: "error",
  unknown: "neutral",
};

const LEVEL_LABEL: Record<ComplianceLevel, string> = {
  ok: "Within limit",
  at_risk: "Near limit",
  over: "Over limit",
  unknown: "No answers yet",
};

const METHOD_LABEL: Record<string, string> = {
  MANUAL: "Manual",
  RATIO: "Predictive, fixed",
  ADAPT_HARD_LIMIT: "Predictive, hard limit",
  ADAPT_TAPERED: "Predictive, tapered",
  ADAPT_AVERAGE: "Predictive, average",
};

function rateLabel(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 10) / 10}%`;
}

export default async function CampaignsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const today = dialerDay();

  const [{ data: live }, { data: todayStats }, { data: week }] = await Promise.all([
    supabase.from("campaigns_live").select("*").order("campaign_id"),
    supabase.from("campaign_stats_daily").select("*").eq("day", today),
    supabase.from("campaign_stats_daily").select("*").order("day", { ascending: false }).limit(60),
  ]);

  const campaigns = live ?? [];
  const byCampaign = new Map((todayStats ?? []).map((s) => [s.campaign_id, s]));

  const totals = (todayStats ?? []).reduce(
    (acc, s) => ({ calls: acc.calls + s.calls, connected: acc.connected + s.connected, drops: acc.drops + s.drops, talk: acc.talk + s.talk_sec }),
    { calls: 0, connected: 0, drops: 0, talk: 0 },
  );
  const poolRate = abandonRate(totals);
  const poolLevel = complianceLevel(poolRate);
  const agents = campaigns.reduce((n, c) => n + (c.agents_logged_in ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description={`How each campaign is dialing today, and how its abandoned calls stand against the ${TSR_ABANDON_CAP_PCT}% daily limit. Change the pacing in Settings → Dialing.`}
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Calls today" value={totals.calls.toLocaleString()} note={`${totals.connected} reached an agent`} icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />} />
        <KpiCard
          label="Abandoned"
          value={rateLabel(poolRate)}
          note={poolRate === null ? "Nobody has answered yet" : `${totals.drops} of ${totals.connected + totals.drops} answered · limit ${TSR_ABANDON_CAP_PCT}%`}
          noteTone={poolLevel === "over" ? "error" : poolLevel === "at_risk" ? "warning" : "muted"}
          icon={<ShieldAlert className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard label="Agents on" value={agents} note={`${campaigns.filter((c) => c.active).length} campaign${campaigns.length === 1 ? "" : "s"} active`} icon={<Headset className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Talk time" value={formatDuration(totals.talk)} note={totals.connected ? `${formatDuration(Math.round(totals.talk / totals.connected))} a call` : undefined} icon={<Timer className="size-5" strokeWidth={1.75} />} />
      </div>

      {poolLevel === "over" && (
        <Alert>
          Abandoned calls are at {rateLabel(poolRate)} today, above the {TSR_ABANDON_CAP_PCT}% limit. The rate is measured across the whole day, so it can only be diluted, not undone:
          about {callsToRecover(totals)?.toLocaleString()} more answered calls with no further abandons would bring it back. Lower the lines per agent in{" "}
          <Link href="/settings?tab=dialing">Settings → Dialing</Link>.
        </Alert>
      )}

      <Panel title="Today" subtitle="One row per campaign, newest sync first." bodyClassName="px-2 pb-2">
        <DataTable head={["Campaign", "Dialing", "Agents", "Calls", "Connected", "Abandoned", "Headroom", "Hopper"]} minWidth={1040} bare>
          {campaigns.length === 0 ? (
            <EmptyRow colSpan={8}>No campaign has synced yet. The dialer agent sends this every 15 minutes.</EmptyRow>
          ) : (
            campaigns.map((c) => {
              const s = byCampaign.get(c.campaign_id) ?? { calls: 0, connected: 0, drops: 0 };
              const rate = abandonRate(s);
              const level = complianceLevel(rate);
              const headroom = abandonsRemaining(s);
              const lines = Number(c.lines_per_agent ?? 0);
              return (
                <tr key={c.campaign_id}>
                  <td>
                    <Link href={`/campaigns/${c.campaign_id}`} className="flex flex-col hover:underline">
                      <span className="font-semibold text-ink">{c.campaign_id}</span>
                      <span className="text-legal text-muted">{c.active ? `synced ${relative(c.synced_at)}` : "Not active"}</span>
                    </Link>
                  </td>
                  <td>
                    <span className="flex flex-col">
                      <span>{METHOD_LABEL[c.dial_method ?? ""] ?? c.dial_method}</span>
                      <span className="text-legal text-muted">{lines > 0 ? `${lines} lines per agent` : "one call at a time"}</span>
                    </span>
                  </td>
                  <td className="tabular-nums">{c.agents_logged_in ?? 0}</td>
                  <td className="tabular-nums">{s.calls.toLocaleString()}</td>
                  <td className="tabular-nums">{s.connected.toLocaleString()}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <StatusPill tone={LEVEL_TONE[level]}>{rateLabel(rate)}</StatusPill>
                      <span className="text-legal text-muted">{LEVEL_LABEL[level]}</span>
                    </span>
                  </td>
                  <td className="tabular-nums">
                    {rate === null ? (
                      <span className="text-muted">—</span>
                    ) : headroom >= 0 ? (
                      <span>
                        {headroom} more drop{headroom === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="text-error">{Math.abs(headroom)} over</span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {c.leads_in_hopper ?? 0} / {c.hopper_level ?? 0}
                  </td>
                </tr>
              );
            })
          )}
        </DataTable>
      </Panel>

      <Panel title="Last 7 days" subtitle="Abandoned-call rate by day. Each day stands on its own against the limit." bodyClassName="px-2 pb-2">
        <DataTable head={["Day", "Campaign", "Calls", "Answered", "Connected", "Abandoned", "Rate", "Talk time"]} minWidth={900} bare>
          {(week ?? []).length === 0 ? (
            <EmptyRow colSpan={8}>Nothing recorded yet.</EmptyRow>
          ) : (
            (week ?? []).map((s) => {
              const rate = abandonRate(s);
              const level = complianceLevel(rate);
              return (
                <tr key={`${s.campaign_id}-${s.day}`}>
                  <td className="tabular-nums">{s.day}</td>
                  <td className="font-semibold !text-ink">{s.campaign_id}</td>
                  <td className="tabular-nums">{s.calls.toLocaleString()}</td>
                  <td className="tabular-nums">{(s.connected + s.drops).toLocaleString()}</td>
                  <td className="tabular-nums">{s.connected.toLocaleString()}</td>
                  <td className="tabular-nums">{s.drops.toLocaleString()}</td>
                  <td>
                    <StatusPill tone={LEVEL_TONE[level]}>{rateLabel(rate)}</StatusPill>
                  </td>
                  <td className="tabular-nums">{formatDuration(s.talk_sec)}</td>
                </tr>
              );
            })
          )}
        </DataTable>
      </Panel>
    </>
  );
}
