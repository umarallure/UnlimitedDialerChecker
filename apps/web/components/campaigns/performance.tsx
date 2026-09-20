import { Clock, PhoneOutgoing, ShieldAlert, Timer, UserCheck } from "lucide-react";
import { TSR_ABANDON_CAP_PCT, complianceLevel } from "@udc/policy";
import { DataTable, EmptyRow, KpiCard, Metric, Panel, ShareBar, StatusPill } from "@/components/ui";
import {
  byAgent,
  byDay,
  byHour,
  byStatus,
  describeRange,
  filterRows,
  summarize,
  type StatRow,
  type StatsFilters,
  type StatusMeta,
} from "@/lib/campaign-stats";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDuration } from "@/lib/time";

/**
 * Everything a manager needs to judge a campaign, over whatever window they asked for.
 *
 * All of it is summed from `campaign_call_stats`, one read, so the outcome table, the agent
 * table and the KPI row can never disagree with each other. A rate is shown as "—" rather than
 * 0% when its denominator is empty: "0% contact" on a campaign that placed no calls reads like
 * a failure instead of an absence.
 */

const PAGE = 1000;
const MAX_ROWS = 20000;

async function loadStats(campaignId: string, filters: StatsFilters): Promise<StatRow[]> {
  const supabase = await createClient();
  const rows: StatRow[] = [];

  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("campaign_call_stats")
      .select("day, hour, agent_user, status, calls, talk_sec, calls_60_plus, calls_120_plus, calls_300_plus")
      .eq("campaign_id", campaignId)
      .gte("day", filters.from)
      .lte("day", filters.to)
      .order("day", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as StatRow[]));
    if (!data || data.length < PAGE) break;
  }

  return rows;
}

function pctText(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 10) / 10}%`;
}

export async function CampaignPerformance({
  campaignId,
  filters,
  dialable,
}: {
  campaignId: string;
  filters: StatsFilters;
  /** Lead statuses this campaign will still dial, for the "left to dial" column. */
  dialable: string[];
}) {
  const supabase = await createClient();
  const [all, { data: statusRows }, { data: leadRows }, { data: userRows }] = await Promise.all([
    loadStats(campaignId, filters),
    supabase
      .from("dialer_campaign_statuses")
      .select("campaign_id, status, status_name, human_answered, sale, dnc, not_interested, scheduled_callback, selectable")
      .in("campaign_id", [campaignId, "-"]),
    supabase.from("dialer_leads").select("owner, status").eq("campaign_id", campaignId),
    supabase.from("dialer_users").select("user_name, full_name"),
  ]);

  // A campaign's own wording wins over the shared system status of the same code.
  const withOwner = (statusRows ?? []) as (StatusMeta & { campaign_id: string })[];
  const meta: StatusMeta[] = [...withOwner]
    .sort((a, b) => Number(b.campaign_id === campaignId) - Number(a.campaign_id === campaignId))
    .filter((m, i, list) => list.findIndex((x) => x.status === m.status) === i);

  const rows = filterRows(all, filters);
  const s = summarize(rows, meta);
  const outcomes = byStatus(rows, meta);
  const agents = byAgent(rows, meta);
  const hours = byHour(rows, meta).filter((h) => h.calls > 0);
  const days = byDay(rows, meta);
  const busiest = Math.max(1, ...hours.map((h) => h.calls));
  const level = complianceLevel(s.abandonPct);
  const window = describeRange(filters);

  const fullName = (user: string) => (userRows ?? []).find((u) => u.user_name === user)?.full_name || user;
  const leadsOf = (owner: string) => {
    const mine = (leadRows ?? []).filter((l) => l.owner === owner);
    return { total: mine.length, waiting: mine.filter((l) => l.status && dialable.includes(l.status)).length };
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Calls placed"
          value={s.calls.toLocaleString()}
          note={window}
          icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Contact rate"
          value={pctText(s.contactRate)}
          note={`${s.contacted.toLocaleString()} answered by a person`}
          icon={<UserCheck className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard
          label="2 min or longer"
          value={s.twoMinPlus.toLocaleString()}
          note={s.connected ? `${pctText(s.twoMinRate)} of calls an agent took` : "No calls reached an agent"}
          icon={<Timer className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Abandoned"
          value={pctText(s.abandonPct)}
          note={s.abandonPct === null ? "Nobody has answered yet" : `${s.drops.toLocaleString()} dropped · limit ${TSR_ABANDON_CAP_PCT}%`}
          noteTone={level === "over" ? "error" : level === "at_risk" ? "warning" : "muted"}
          icon={<ShieldAlert className="size-5" strokeWidth={1.75} />}
        />
      </div>

      <Panel title="The rest of the picture" subtitle={`Every figure covers ${window}.`} bodyClassName="px-6 pb-6">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Pickup rate" value={pctText(s.pickupRate)} note="People and machines" />
          <Metric label="Reached an agent" value={s.connected.toLocaleString()} note="Calls an agent took" />
          <Metric label="Answering machines" value={s.machines.toLocaleString()} note="Nobody there to talk to" />
          <Metric label="Rang out or busy" value={s.noAnswer.toLocaleString()} note="No pickup at all" />
          <Metric label="Average talk time" value={formatDuration(s.avgTalkSec)} note="Per call an agent took" />
          <Metric label="Total talk time" value={formatDuration(s.talkSec)} note="Across every agent" />
          <Metric label="5 min or longer" value={s.fiveMinPlus.toLocaleString()} note="The real conversations" />
          <Metric label="Sales and callbacks" value={`${s.sales.toLocaleString()} · ${s.callbacks.toLocaleString()}`} note="Sales, then booked callbacks" />
        </dl>
      </Panel>

      <Panel
        title="Outcomes"
        subtitle="Every disposition recorded in this window, busiest first. Agent-chosen outcomes are marked."
        bodyClassName="px-2 pb-2"
      >
        <DataTable head={["Outcome", "Code", "Calls", "Share", "Talk time"]} minWidth={720} bare alignRight={[2, 4]}>
          {outcomes.length === 0 ? (
            <EmptyRow colSpan={5}>No calls in this window.</EmptyRow>
          ) : (
            outcomes.map((o) => (
              <tr key={o.status}>
                <td className="font-semibold !text-ink">
                  <span className="flex flex-wrap items-center gap-2">
                    {o.name}
                    {o.selectable ? (
                      <StatusPill tone={o.tone === "sale" ? "success" : o.tone === "callback" ? "accent" : o.tone === "negative" ? "error" : "neutral"}>
                        agent chose
                      </StatusPill>
                    ) : (
                      <StatusPill>automatic</StatusPill>
                    )}
                  </span>
                </td>
                <td className="font-mono">{o.status}</td>
                <td className="text-right tabular-nums">{o.calls.toLocaleString()}</td>
                <td>
                  <span className="flex items-center gap-3">
                    <ShareBar pct={o.share} tone={o.tone === "sale" ? "success" : o.tone === "negative" ? "error" : "neutral"} />
                    <span className="w-12 shrink-0 text-right tabular-nums">{Math.round(o.share * 10) / 10}%</span>
                  </span>
                </td>
                <td className="text-right tabular-nums">{formatDuration(o.talkSec)}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Panel>

      <Panel title="Agents" subtitle="What each of them did in this window, and what they still have to dial." bodyClassName="px-2 pb-2">
        <DataTable head={["Agent", "Calls taken", "Talk time", "Average", "2 min+", "Sales", "Leads left"]} minWidth={860} bare alignRight={[1, 2, 3, 4, 5, 6]}>
          {agents.length === 0 ? (
            <EmptyRow colSpan={7}>No agent took a call in this window.</EmptyRow>
          ) : (
            agents.map((a) => {
              const leads = leadsOf(a.agent);
              return (
                <tr key={a.agent}>
                  <td className="font-semibold !text-ink">
                    {fullName(a.agent)} <span className="font-normal text-muted">{a.agent}</span>
                  </td>
                  <td className="text-right tabular-nums">{a.calls.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{formatDuration(a.talkSec)}</td>
                  <td className="text-right tabular-nums">{formatDuration(a.calls ? Math.round(a.talkSec / a.calls) : null)}</td>
                  <td className="text-right tabular-nums">{a.twoMinPlus.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{a.sales.toLocaleString()}</td>
                  <td className="text-right tabular-nums">
                    {leads.waiting > 0 ? leads.waiting.toLocaleString() : <span className="text-warning">nothing left</span>}
                  </td>
                </tr>
              );
            })
          )}
        </DataTable>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Time of day" subtitle="Where the answers are, summed across the window." bodyClassName="flex flex-col gap-2 px-6 pb-6">
          {hours.length === 0 ? (
            <p className="py-6 text-center text-caption text-muted">No calls in this window.</p>
          ) : (
            hours.map((h) => (
              <div key={h.hour} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-legal tabular-nums text-muted">
                  {h.hour % 12 === 0 ? 12 : h.hour % 12}:00 {h.hour < 12 ? "am" : "pm"}
                </span>
                <span className="flex h-5 min-w-0 flex-1 items-center">
                  <ShareBar pct={(h.calls / busiest) * 100} tone="accent" />
                </span>
                <span className="w-28 shrink-0 text-right text-legal tabular-nums text-graphite">
                  {h.calls.toLocaleString()} · {h.contacted.toLocaleString()} answered
                </span>
              </div>
            ))
          )}
        </Panel>

        <Panel title="Day by day" subtitle="Calls placed, answered by a person, and taken by an agent." bodyClassName="px-2 pb-2">
          <DataTable head={["Day", "Calls", "Answered", "To an agent", "Contact"]} minWidth={480} bare alignRight={[1, 2, 3, 4]}>
            {days.length === 0 ? (
              <EmptyRow colSpan={5}>No calls in this window.</EmptyRow>
            ) : (
              days.map((d) => (
                <tr key={d.day}>
                  <td className="font-semibold !text-ink">{formatDate(`${d.day}T12:00:00Z`)}</td>
                  <td className="text-right tabular-nums">{d.calls.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{d.contacted.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{d.connected.toLocaleString()}</td>
                  <td className="text-right tabular-nums">{pctText(d.calls ? (d.contacted / d.calls) * 100 : null)}</td>
                </tr>
              ))
            )}
          </DataTable>
        </Panel>
      </div>

      <p className="flex items-center gap-2 text-legal text-muted">
        <Clock aria-hidden className="size-3.5" /> Figures are rebuilt from the dialer every few minutes, so the last
        call or two may not be counted yet.
      </p>
    </>
  );
}
