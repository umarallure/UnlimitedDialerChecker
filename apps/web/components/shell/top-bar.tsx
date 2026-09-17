import Link from "next/link";
import { Bell, ChevronDown, LogOut, Search } from "lucide-react";
import { BrandMark } from "./brand";

export function AnnouncementBar({ tone, message, detail }: { tone: "ok" | "warn"; message: string; detail?: string }) {
  return (
    <div className="bg-ink text-on-dark">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 text-caption lg:px-8">
        <span aria-hidden className={`size-3 shrink-0 rounded-full ${tone === "ok" ? "bg-success" : "bg-primary"}`} />
        <span className="font-medium">{message}</span>
        {detail && (
          <>
            <span aria-hidden className="hidden h-4 w-px bg-on-dark/30 sm:block" />
            <span className="text-on-dark/80">{detail}</span>
          </>
        )}
      </div>
    </div>
  );
}

function initials(email: string) {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || "AD";
}

export function TopBar({ email, openAlerts }: { email: string; openAlerts: number }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="flex h-[76px] items-center gap-6 px-6 lg:px-0">
        <div className="flex h-full shrink-0 items-center lg:w-[248px] lg:border-r lg:border-line lg:px-6">
          <BrandMark />
        </div>

        <form action="/numbers" method="get" role="search" className="hidden max-w-[560px] flex-1 md:block lg:pl-6">
          <label className="relative block">
            <span className="sr-only">Search numbers</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
            <input
              id="global-search"
              name="q"
              type="search"
              placeholder="Search numbers, area codes, or states…"
              className="h-11 w-full rounded-md border border-line bg-surface-alt pr-4 pl-11 text-caption text-ink placeholder:text-muted focus:border-line-strong focus:bg-surface focus:outline-none"
            />
          </label>
        </form>

        <div className="ml-auto flex items-center gap-2 lg:pr-8">
          <Link
            href="/alerts"
            aria-label={openAlerts ? `${openAlerts} open alerts` : "No open alerts"}
            className="relative flex size-11 items-center justify-center rounded-full text-graphite hover:bg-surface-alt"
          >
            <Bell aria-hidden className="size-5" strokeWidth={1.75} />
            {openAlerts > 0 && <span aria-hidden className="absolute top-2.5 right-3 size-2 rounded-full bg-primary ring-2 ring-surface" />}
          </Link>

          <span aria-hidden className="mx-2 hidden h-8 w-px bg-line sm:block" />

          <details className="group relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-full py-1 pr-2 pl-1 hover:bg-surface-alt [&::-webkit-details-marker]:hidden">
              <span className="flex size-10 items-center justify-center rounded-full bg-surface-alt text-button text-ink">{initials(email)}</span>
              <span className="hidden flex-col text-left leading-tight sm:flex">
                <span className="text-caption font-semibold text-ink">{email.split("@")[0]}</span>
                <span className="text-legal text-muted">Super admin</span>
              </span>
              <ChevronDown aria-hidden className="size-4 text-graphite transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-line bg-surface p-2 shadow-card-hover">
              <p className="truncate px-3 py-2 text-caption text-muted">{email}</p>
              <form action="/auth/signout" method="post">
                <button className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-button text-ink hover:bg-surface-alt">
                  <LogOut aria-hidden className="size-4" />
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
