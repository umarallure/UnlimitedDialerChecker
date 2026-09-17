/** The dialer runs on US Eastern time; all "today" figures follow the dialer's calendar. */
export const DIALER_TZ = "America/New_York";

export function dialerDay(offsetDays = 0, now = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: DIALER_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: DIALER_TZ, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: DIALER_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: DIALER_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: DIALER_TZ, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

/** "2 min ago", "3 h ago", or a date. */
export function relative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "never";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return formatDate(iso);
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const d = e164.replace(/^\+1/, "");
  return /^\d{10}$/.test(d) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** ISO timestamp `hours` before now (request time on the server). */
export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** True when `iso` is within `maxAgeMs` of now. */
export function isFresh(iso: string | null | undefined, maxAgeMs: number): boolean {
  return Boolean(iso) && Date.now() - new Date(iso as string).getTime() < maxAgeMs;
}
