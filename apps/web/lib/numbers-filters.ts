/** Filtering, searching and paging for the number pool. All state lives in the URL. */

export const LIFECYCLES = ["NEW", "WARMING", "ACTIVE", "COOLING", "RETIRED"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export const HOLDS = { held: "On hold", free: "Not held" } as const;
export type Hold = keyof typeof HOLDS;

export const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_SIZE = 50;

export type NumberFilters = { q: string; lifecycle: Lifecycle | null; state: string | null; hold: Hold | null; page: number; size: number };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parseFilters(params: Record<string, string | string[] | undefined>): NumberFilters {
  const lifecycle = str(params.lifecycle);
  const state = str(params.state).toUpperCase();
  const hold = str(params.hold);
  const size = Number(str(params.size));
  const page = Number(str(params.page));
  return {
    q: str(params.q).slice(0, 60),
    lifecycle: (LIFECYCLES as readonly string[]).includes(lifecycle) ? (lifecycle as Lifecycle) : null,
    state: /^[A-Z]{2}$/.test(state) ? state : null,
    hold: hold in HOLDS ? (hold as Hold) : null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_SIZE,
  };
}

export function hasFilters(f: NumberFilters): boolean {
  return Boolean(f.q) || f.lifecycle !== null || f.state !== null || f.hold !== null;
}

/**
 * PostgREST `or` clause for the search box: number, area code, state or CNAM.
 * Input is reduced to an allowlist first — commas, parens and quotes are the filter
 * grammar's own separators, so they must never reach the query.
 */
export function searchClause(q: string): string | null {
  const clean = q.replace(/[^a-z0-9 .@_+-]/gi, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const digits = clean.replace(/\D/g, "");
  const ors: string[] = [];
  if (digits) {
    ors.push(`e164.ilike.%${digits}%`);
    if (digits.length === 3) ors.push(`area_code.eq.${digits}`);
  }
  if (/^[a-z]{2}$/i.test(clean)) ors.push(`state.eq.${clean.toUpperCase()}`);
  ors.push(`cnam.ilike.%${clean}%`);
  return ors.join(",");
}

/** Link back to the same view with some filters changed. Changing a filter resets to page 1. */
export function numbersHref(f: NumberFilters, overrides: Partial<NumberFilters> = {}): string {
  const next = { ...f, ...overrides };
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  if (next.lifecycle) sp.set("lifecycle", next.lifecycle);
  if (next.state) sp.set("state", next.state);
  if (next.hold) sp.set("hold", next.hold);
  if (next.size !== DEFAULT_SIZE) sp.set("size", String(next.size));
  if (next.page > 1) sp.set("page", String(next.page));
  const qs = sp.toString();
  return qs ? `/numbers?${qs}` : "/numbers";
}
