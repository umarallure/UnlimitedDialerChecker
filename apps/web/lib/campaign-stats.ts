import { abandonRate } from "@udc/policy";
import { OUTCOMES } from "./calls";

/**
 * Reading a campaign's call record.
 *
 * The rows come from `campaign_call_stats`, one per day, hour, agent and outcome. Everything a
 * manager sees is a sum over those rows, which is why the date and hour filters can be applied
 * to any figure on the page without a different query behind each one.
 *
 * What counts as "answered" is taken from the dialer's own flags where we have them
 * (`dialer_campaign_statuses.human_answered`), not from a list kept here. A campaign can invent
 * its own outcomes at any time, and a report that quietly drops them is worse than no report.
 */

export type StatRow = {
  day: string;
  hour: number;
  agent_user: string;
  status: string;
  calls: number;
  talk_sec: number;
  calls_60_plus: number;
  calls_120_plus: number;
  calls_300_plus: number;
};

export type StatusMeta = {
  status: string;
  status_name: string | null;
  human_answered: boolean;
  sale: boolean;
  dnc: boolean;
  not_interested: boolean;
  scheduled_callback: boolean;
  selectable: boolean;
};

const MACHINE: ReadonlySet<string> = new Set<string>(OUTCOMES.machine.statuses);
const DROPPED: ReadonlySet<string> = new Set<string>(OUTCOMES.dropped.statuses);
const NO_ANSWER: ReadonlySet<string> = new Set<string>([...OUTCOMES.no_answer.statuses, ...OUTCOMES.busy.statuses]);
const CONNECTED: ReadonlySet<string> = new Set<string>(OUTCOMES.connected.statuses);

/**
 * Calls that never reached a final outcome: the agent was connected and the call ended without
 * being dispositioned, so VICIdial leaves the lead where it was. A person was on the line, so
 * they count as contact when an agent was on them — but only then, because the same codes appear
 * on calls the dialer was still working.
 */
const UNFINISHED: ReadonlySet<string> = new Set<string>(["INCALL", "DISPO", "QUEUE"]);

function isContact(r: StatRow, human: ReadonlySet<string>): boolean {
  return human.has(r.status) || (Boolean(r.agent_user) && UNFINISHED.has(r.status));
}

/** Statuses the dialer marks as human-answered, plus the ones we already know to be. */
export function humanAnsweredSet(meta: StatusMeta[]): Set<string> {
  const set = new Set<string>([...CONNECTED, ...DROPPED]);
  for (const m of meta) {
    if (m.human_answered) set.add(m.status);
    else if (MACHINE.has(m.status) || NO_ANSWER.has(m.status)) set.delete(m.status);
  }
  return set;
}

/** The name a manager should read for a status code. */
export function statusName(status: string, meta: StatusMeta[]): string {
  return meta.find((m) => m.status === status)?.status_name?.trim() || status;
}

// ---------------------------------------------------------------- filters

export const PRESETS = {
  today: { label: "Today", days: 0 },
  "7d": { label: "Last 7 days", days: 6 },
  "30d": { label: "Last 30 days", days: 29 },
} as const;

export type Preset = keyof typeof PRESETS;

export type StatsFilters = {
  /** Inclusive dialer-local dates, YYYY-MM-DD. */
  from: string;
  to: string;
  /** Inclusive hours of the dialer's day, 0 to 23. */
  hourFrom: number;
  hourTo: number;
  agent: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function hourOf(value: string, fallback: number): number {
  const n = Number(value);
  return value !== "" && Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Read the filters out of the URL. Anything unrecognised falls back to the last seven days and
 * the whole clock, so a hand-edited address shows a sensible page rather than an error.
 */
export function parseStatsFilters(params: Record<string, string | string[] | undefined>, today: string): StatsFilters {
  const preset = str(params.preset);
  const rawFrom = str(params.from);
  const rawTo = str(params.to);

  let from: string;
  let to = DATE.test(rawTo) ? rawTo : today;
  if (preset in PRESETS) {
    to = today;
    from = daysBefore(today, PRESETS[preset as Preset].days);
  } else if (DATE.test(rawFrom)) {
    from = rawFrom;
  } else {
    from = daysBefore(today, PRESETS["7d"].days);
  }
  if (from > to) [from, to] = [to, from];

  const hourFrom = hourOf(str(params.hfrom), 0);
  const hourTo = hourOf(str(params.hto), 23);

  return {
    from,
    to,
    hourFrom: Math.min(hourFrom, hourTo),
    hourTo: Math.max(hourFrom, hourTo),
    agent: str(params.agent).slice(0, 20),
  };
}

/** The preset a filter set matches exactly, if any, so the right chip can look selected. */
export function matchedPreset(f: StatsFilters, today: string): Preset | null {
  if (f.to !== today || f.hourFrom !== 0 || f.hourTo !== 23) return null;
  for (const [key, p] of Object.entries(PRESETS)) {
    if (f.from === daysBefore(today, p.days)) return key as Preset;
  }
  return null;
}

export function statsHref(campaignId: string, f: StatsFilters, overrides: Partial<StatsFilters> = {}): string {
  const next = { ...f, ...overrides };
  const sp = new URLSearchParams();
  sp.set("from", next.from);
  sp.set("to", next.to);
  if (next.hourFrom !== 0) sp.set("hfrom", String(next.hourFrom));
  if (next.hourTo !== 23) sp.set("hto", String(next.hourTo));
  if (next.agent) sp.set("agent", next.agent);
  return `/campaigns/${encodeURIComponent(campaignId)}?${sp.toString()}`;
}

/** Hours and agent are applied here; the dates are already in the query. */
export function filterRows(rows: StatRow[], f: StatsFilters): StatRow[] {
  return rows.filter((r) => r.hour >= f.hourFrom && r.hour <= f.hourTo && (!f.agent || r.agent_user === f.agent));
}

export function describeRange(f: StatsFilters): string {
  const clock = f.hourFrom === 0 && f.hourTo === 23 ? "" : `, ${f.hourFrom}:00 to ${f.hourTo}:59`;
  return (f.from === f.to ? f.from : `${f.from} to ${f.to}`) + clock;
}

// ---------------------------------------------------------------- figures

export type Summary = {
  calls: number;
  /** A person picked up, whether or not an agent was free. */
  contacted: number;
  /** An agent took the call. */
  connected: number;
  drops: number;
  machines: number;
  noAnswer: number;
  talkSec: number;
  avgTalkSec: number | null;
  twoMinPlus: number;
  fiveMinPlus: number;
  sales: number;
  callbacks: number;
  /** Percentages, or null when there is nothing to divide by. */
  contactRate: number | null;
  pickupRate: number | null;
  twoMinRate: number | null;
  abandonPct: number | null;
};

const pct = (part: number, whole: number): number | null => (whole === 0 ? null : (part / whole) * 100);

export function summarize(rows: StatRow[], meta: StatusMeta[]): Summary {
  const human = humanAnsweredSet(meta);
  const sales = new Set(meta.filter((m) => m.sale).map((m) => m.status));
  const callbacks = new Set(meta.filter((m) => m.scheduled_callback).map((m) => m.status));

  const s: Summary = {
    calls: 0,
    contacted: 0,
    connected: 0,
    drops: 0,
    machines: 0,
    noAnswer: 0,
    talkSec: 0,
    avgTalkSec: null,
    twoMinPlus: 0,
    fiveMinPlus: 0,
    sales: 0,
    callbacks: 0,
    contactRate: null,
    pickupRate: null,
    twoMinRate: null,
    abandonPct: null,
  };

  for (const r of rows) {
    s.calls += r.calls;
    if (isContact(r, human)) s.contacted += r.calls;
    if (DROPPED.has(r.status)) s.drops += r.calls;
    if (MACHINE.has(r.status)) s.machines += r.calls;
    if (NO_ANSWER.has(r.status)) s.noAnswer += r.calls;
    if (sales.has(r.status)) s.sales += r.calls;
    if (callbacks.has(r.status)) s.callbacks += r.calls;

    // Talk time only means anything on a call an agent actually took.
    if (r.agent_user) {
      s.connected += r.calls;
      s.talkSec += r.talk_sec;
      s.twoMinPlus += r.calls_120_plus;
      s.fiveMinPlus += r.calls_300_plus;
    }
  }

  s.avgTalkSec = s.connected ? Math.round(s.talkSec / s.connected) : null;
  s.contactRate = pct(s.contacted, s.calls);
  s.pickupRate = pct(s.contacted + s.machines, s.calls);
  s.twoMinRate = pct(s.twoMinPlus, s.connected);
  s.abandonPct = abandonRate({ connected: Math.max(s.contacted - s.drops, 0), drops: s.drops });
  return s;
}

export type DispositionRow = {
  status: string;
  name: string;
  calls: number;
  share: number;
  talkSec: number;
  selectable: boolean;
  tone: "sale" | "callback" | "negative" | "neutral";
};

/** Every outcome the campaign recorded in the range, busiest first. */
export function byStatus(rows: StatRow[], meta: StatusMeta[]): DispositionRow[] {
  const totals = new Map<string, { calls: number; talkSec: number }>();
  let all = 0;
  for (const r of rows) {
    const t = totals.get(r.status) ?? { calls: 0, talkSec: 0 };
    t.calls += r.calls;
    t.talkSec += r.talk_sec;
    totals.set(r.status, t);
    all += r.calls;
  }

  return [...totals.entries()]
    .map(([status, t]) => {
      const m = meta.find((x) => x.status === status);
      const tone: DispositionRow["tone"] = m?.sale
        ? "sale"
        : m?.scheduled_callback
          ? "callback"
          : m?.dnc || m?.not_interested
            ? "negative"
            : "neutral";
      return {
        status,
        name: statusName(status, meta),
        calls: t.calls,
        share: all ? (t.calls / all) * 100 : 0,
        talkSec: t.talkSec,
        selectable: m?.selectable ?? false,
        tone,
      };
    })
    .sort((a, b) => b.calls - a.calls || a.status.localeCompare(b.status));
}

export type AgentRow = { agent: string; calls: number; talkSec: number; twoMinPlus: number; sales: number };

/** Per-agent totals for calls an agent took. Dialer-only rows carry no agent and are left out. */
export function byAgent(rows: StatRow[], meta: StatusMeta[]): AgentRow[] {
  const sales = new Set(meta.filter((m) => m.sale).map((m) => m.status));
  const totals = new Map<string, AgentRow>();

  for (const r of rows) {
    if (!r.agent_user) continue;
    const a = totals.get(r.agent_user) ?? { agent: r.agent_user, calls: 0, talkSec: 0, twoMinPlus: 0, sales: 0 };
    a.calls += r.calls;
    a.talkSec += r.talk_sec;
    a.twoMinPlus += r.calls_120_plus;
    if (sales.has(r.status)) a.sales += r.calls;
    totals.set(r.agent_user, a);
  }

  return [...totals.values()].sort((a, b) => b.calls - a.calls || a.agent.localeCompare(b.agent));
}

export type HourRow = { hour: number; calls: number; contacted: number };

/** Calls by hour of the day, summed across the range: where the answers actually are. */
export function byHour(rows: StatRow[], meta: StatusMeta[]): HourRow[] {
  const human = humanAnsweredSet(meta);
  const hours: HourRow[] = Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0, contacted: 0 }));
  for (const r of rows) {
    const h = hours[r.hour];
    if (!h) continue;
    h.calls += r.calls;
    if (isContact(r, human)) h.contacted += r.calls;
  }
  return hours;
}

export type DayRow = { day: string; calls: number; contacted: number; connected: number };

export function byDay(rows: StatRow[], meta: StatusMeta[]): DayRow[] {
  const human = humanAnsweredSet(meta);
  const days = new Map<string, DayRow>();
  for (const r of rows) {
    const d = days.get(r.day) ?? { day: r.day, calls: 0, contacted: 0, connected: 0 };
    d.calls += r.calls;
    if (isContact(r, human)) d.contacted += r.calls;
    if (r.agent_user) d.connected += r.calls;
    days.set(r.day, d);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
