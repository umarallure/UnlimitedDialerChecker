/** Filtering, searching and paging for the call feed. All state lives in the URL. */

/** Statuses that mean a human picked up (drops included: someone answered, then we lost them). */
export const ANSWERED_STATUSES = ["SALE", "CALLBK", "CBHOLD", "NI", "DEC", "DNC", "DROP", "PDROP", "NP", "QCFAIL", "XFER"];

/** Operator-facing outcome groups. Raw VICIdial codes stay visible in the table. */
export const OUTCOMES = {
  connected: { label: "Connected", statuses: ["SALE", "CALLBK", "CBHOLD", "NI", "DEC", "DNC", "NP", "QCFAIL", "XFER"] },
  dropped: { label: "Dropped", statuses: ["DROP", "PDROP"] },
  machine: { label: "Answering machine", statuses: ["A", "AA", "AM", "AL"] },
  no_answer: { label: "No answer", statuses: ["NA", "N", "NANQUE", "TIMEOT"] },
  busy: { label: "Busy", statuses: ["B"] },
  failed: { label: "Failed or disconnected", statuses: ["DC", "ADC", "ERI", "CONGESTION"] },
} as const;

export type Outcome = keyof typeof OUTCOMES;

export const RANGES = {
  "24h": { label: "Last 24 hours", hours: 24 },
  "3d": { label: "Last 3 days", hours: 72 },
  "7d": { label: "Last 7 days", hours: null },
} as const;

export type Range = keyof typeof RANGES;

export const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_SIZE = 50;

export type CallFilters = { q: string; outcome: Outcome | null; range: Range; page: number; size: number };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Read filters from searchParams, ignoring anything we don't recognise. */
export function parseFilters(params: Record<string, string | string[] | undefined>): CallFilters {
  const outcome = str(params.outcome);
  const range = str(params.range);
  const size = Number(str(params.size));
  const page = Number(str(params.page));
  return {
    q: str(params.q).slice(0, 60),
    outcome: outcome in OUTCOMES ? (outcome as Outcome) : null,
    range: range in RANGES ? (range as Range) : "7d",
    page: Number.isInteger(page) && page > 1 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_SIZE,
  };
}

export function hasFilters(f: CallFilters): boolean {
  return Boolean(f.q) || f.outcome !== null || f.range !== "7d";
}

/**
 * PostgREST `or` clause for the search box: caller ID, lead last 4, agent or campaign.
 * Input is reduced to an allowlist first — commas, parens and quotes are the filter grammar's
 * own separators, so they must never reach the query.
 */
export function searchClause(q: string): string | null {
  const clean = q.replace(/[^a-z0-9 .@_+-]/gi, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const digits = clean.replace(/\D/g, "");
  const ors: string[] = [];
  if (digits) {
    ors.push(`outbound_cid.ilike.%${digits}%`);
    if (digits.length <= 4) ors.push(`lead_phone_last4.eq.${digits}`);
  }
  ors.push(`agent_user.ilike.%${clean}%`, `campaign_id.ilike.%${clean}%`);
  return ors.join(",");
}

/** Link back to the same view with some filters changed. Changing a filter resets to page 1. */
export function callsHref(f: CallFilters, overrides: Partial<CallFilters> = {}): string {
  const next = { ...f, ...overrides };
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  if (next.outcome) sp.set("outcome", next.outcome);
  if (next.range !== "7d") sp.set("range", next.range);
  if (next.size !== DEFAULT_SIZE) sp.set("size", String(next.size));
  if (next.page > 1) sp.set("page", String(next.page));
  const qs = sp.toString();
  return qs ? `/calls?${qs}` : "/calls";
}
