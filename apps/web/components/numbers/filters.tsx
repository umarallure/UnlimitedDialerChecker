import Link from "next/link";
import { Search, X } from "lucide-react";
import { HOLDS, LIFECYCLES, type NumberFilters, PAGE_SIZES, hasFilters, numbersHref } from "@/lib/numbers-filters";
import { LIFECYCLE_LABEL } from "@/lib/status";

const control = "h-11 rounded-md border border-line bg-surface px-4 text-caption text-ink focus:border-line-strong focus:outline-none";

/**
 * GET form, so every view is a shareable URL and filtering works without client JS.
 * `page` is deliberately not carried over — changing a filter returns you to page 1.
 */
export function NumberFiltersBar({ filters, states, showing }: { filters: NumberFilters; states: string[]; showing: number }) {
  const { q, lifecycle, state, hold, size } = filters;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-4">
      <form action="/numbers" method="get" className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <label className="sr-only" htmlFor="numbers-search">
            Search numbers
          </label>
          <input id="numbers-search" name="q" type="search" defaultValue={q} placeholder="Number, area code or caller name" className={`${control} w-[260px] pl-10`} />
        </div>

        <label className="sr-only" htmlFor="numbers-lifecycle">
          Lifecycle
        </label>
        <select id="numbers-lifecycle" name="lifecycle" defaultValue={lifecycle ?? ""} className={`${control} pr-9`}>
          <option value="">All lifecycles</option>
          {LIFECYCLES.map((l) => (
            <option key={l} value={l}>
              {LIFECYCLE_LABEL[l]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="numbers-state">
          State
        </label>
        <select id="numbers-state" name="state" defaultValue={state ?? ""} className={`${control} pr-9`} disabled={states.length === 0}>
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="numbers-hold">
          Hold
        </label>
        <select id="numbers-hold" name="hold" defaultValue={hold ?? ""} className={`${control} pr-9`}>
          <option value="">Held and not held</option>
          {Object.entries(HOLDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="numbers-size">
          Rows per page
        </label>
        <select id="numbers-size" name="size" defaultValue={size} className={`${control} pr-9`}>
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
          <Link href={numbersHref(filters, { q: "", lifecycle: null, state: null, hold: null, page: 1 })} className="inline-flex min-h-11 items-center gap-1 px-2 text-ink hover:underline">
            <X aria-hidden className="size-4" /> Clear filters
          </Link>
        </p>
      )}
    </div>
  );
}
