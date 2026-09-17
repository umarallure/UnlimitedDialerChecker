import { resolveCid } from "./cid";

/** One outbound dial attempt joined across VICIdial logs. */
export type CallRow = {
  callerCode: string;
  callDate: Date;
  outboundCid: string | null;
  uniqueid: string | null;
  status: string | null;
  lengthSec: number | null;
  agentUser: string | null;
  campaignId: string | null;
  phoneNumber: string | null;
  callType: string | null;
  sipCode: number | null;
  humanAnswered: boolean;
};

export type CidCounters = {
  calls: number;
  callsLastHour: number;
  answered: number;
  shortCalls: number;
  drops: number;
  sipRejects: number;
  sip503: number;
  sip603: number;
  sip608: number;
  talkSecTotal: number;
  uniqueNumbers: Set<string>;
  lastCallAt: Date | null;
};

const DROP_STATUSES = new Set(["DROP", "PDROP"]);

function empty(): CidCounters {
  return {
    calls: 0,
    callsLastHour: 0,
    answered: 0,
    shortCalls: 0,
    drops: 0,
    sipRejects: 0,
    sip503: 0,
    sip603: 0,
    sip608: 0,
    talkSecTotal: 0,
    uniqueNumbers: new Set(),
    lastCallAt: null,
  };
}

/** Group calls by resolved caller ID. Calls without a resolvable CID are skipped. */
export function aggregateByCid(
  rows: CallRow[],
  opts: { now: Date; shortCallSeconds: number; cidOverride: string | null },
): Map<string, CidCounters> {
  const hourAgo = opts.now.getTime() - 3_600_000;
  const out = new Map<string, CidCounters>();

  for (const r of rows) {
    const cid = resolveCid(r.outboundCid, opts.cidOverride);
    if (!cid) continue;
    let c = out.get(cid);
    if (!c) {
      c = empty();
      out.set(cid, c);
    }

    c.calls++;
    if (r.callDate.getTime() >= hourAgo) c.callsLastHour++;
    if (!c.lastCallAt || r.callDate > c.lastCallAt) c.lastCallAt = r.callDate;
    if (r.phoneNumber) c.uniqueNumbers.add(r.phoneNumber);

    if (r.humanAnswered) {
      c.answered++;
      const len = r.lengthSec ?? 0;
      c.talkSecTotal += len;
      if (r.lengthSec !== null && r.lengthSec < opts.shortCallSeconds) c.shortCalls++;
    }
    if (r.status && DROP_STATUSES.has(r.status)) c.drops++;

    if (r.sipCode && r.sipCode >= 400) {
      c.sipRejects++;
      if (r.sipCode === 503) c.sip503++;
      if (r.sipCode === 603) c.sip603++;
      if (r.sipCode === 608) c.sip608++;
    }
  }

  return out;
}

/** Local calendar date (server time zone) as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
