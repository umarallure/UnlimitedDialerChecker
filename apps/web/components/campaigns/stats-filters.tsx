import Link from "next/link";
import { PRESETS, matchedPreset, statsHref, type Preset, type StatsFilters } from "@/lib/campaign-stats";

/**
 * The date and time window every figure on the page is measured over.
 *
 * It is a plain GET form: the window lives in the address, so a manager can bookmark "last month,
 * mornings" or send it to somebody else and have them see the same numbers.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "am" : "pm"}`,
}));

const select = "h-11 rounded-md border border-line bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";
const field = "flex items-center gap-2 text-caption text-muted";

export function StatsFilterBar({
  campaignId,
  filters,
  today,
  agents,
}: {
  campaignId: string;
  filters: StatsFilters;
  today: string;
  agents: string[];
}) {
  const current = matchedPreset(filters, today);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.entries(PRESETS) as [Preset, (typeof PRESETS)[Preset]][]).map(([key, p]) => (
          <Link
            key={key}
            href={`${statsHref(campaignId, { ...filters, hourFrom: 0, hourTo: 23, from: today, to: today })}&preset=${key}`}
            className={
              current === key
                ? "inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-button text-surface"
                : "inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong"
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      <form action={`/campaigns/${campaignId}`} method="get" className="flex flex-wrap items-end gap-3">
        <label className={field}>
          From
          <input type="date" name="from" defaultValue={filters.from} max={today} className={select} />
        </label>
        <label className={field}>
          To
          <input type="date" name="to" defaultValue={filters.to} max={today} className={select} />
        </label>
        <label className={field}>
          Between
          <select name="hfrom" defaultValue={filters.hourFrom} className={select}>
            {HOURS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          and
          <select name="hto" defaultValue={filters.hourTo} className={select}>
            {HOURS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label === "12:00 am" ? "11:59 pm" : h.label}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Agent
          <select name="agent" defaultValue={filters.agent} className={select}>
            <option value="">Everyone</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-button text-on-primary shadow-sm hover:bg-primary-hover">
          Show
        </button>
      </form>

      <p className="text-legal text-muted">
        Hours are the dialer&rsquo;s own clock (US Eastern). The window applies to every figure below.
      </p>
    </div>
  );
}
