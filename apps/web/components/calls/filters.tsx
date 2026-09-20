import Link from "next/link";
import { Search, X } from "lucide-react";
import { type CallFilters, OUTCOMES, PAGE_SIZES, RANGES, callsHref, hasFilters } from "@/lib/calls";

const control = "h-11 rounded-md border border-line bg-surface px-4 text-caption text-ink focus:border-line-strong focus:outline-none";

/**
 * GET form, so every view is a shareable URL and filtering works without client JS.
 * `page` is deliberately not carried over — changing a filter returns you to page 1.
 */
export function CallFiltersBar({ filters, showing }: { filters: CallFilters; showing: number }) {
  const { q, outcome, range, size } = filters;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-4">
      <form action="/calls" method="get" className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <label className="sr-only" htmlFor="calls-search">
            Search calls
          </label>
          <input
            id="calls-search"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Caller ID, last 4, agent or campaign"
            className={`${control} w-[280px] pl-10`}
          />
        </div>

        <label className="sr-only" htmlFor="calls-outcome">
          Outcome
        </label>
        <select id="calls-outcome" name="outcome" defaultValue={outcome ?? ""} className={`${control} pr-9`}>
          <option value="">Any outcome</option>
          {Object.entries(OUTCOMES).map(([value, o]) => (
            <option key={value} value={value}>
              {o.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="calls-range">
          Time range
        </label>
        <select id="calls-range" name="range" defaultValue={range} className={`${control} pr-9`}>
          {Object.entries(RANGES).map(([value, r]) => (
            <option key={value} value={value}>
              {r.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="calls-size">
          Rows per page
        </label>
        <select id="calls-size" name="size" defaultValue={size} className={`${control} pr-9`}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} per page
            </option>
          ))}
        </select>

        <button className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong">
          Apply
        </button>
      </form>

      {hasFilters(filters) && (
        <p className="flex items-center gap-2 text-caption text-muted tabular-nums">
          {showing} shown
          <Link href={callsHref(filters, { q: "", outcome: null, range: "7d", page: 1 })} className="inline-flex min-h-11 items-center gap-1 px-2 text-ink hover:underline">
            <X aria-hidden className="size-4" /> Clear filters
          </Link>
        </p>
      )}
    </div>
  );
}
