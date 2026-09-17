"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type NotificationSettings = {
  recipients: string[];
  immediate_enabled: boolean;
  digest_enabled: boolean;
  digest_hour_et: number;
};

const input = "min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink placeholder:text-muted focus:border-ink focus:outline-none";

function hourLabel(h: number) {
  return new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" });
}

export function NotificationForm({ settings }: { settings: NotificationSettings }) {
  const router = useRouter();
  const [recipients, setRecipients] = useState(settings.recipients.join(", "));
  const [immediate, setImmediate] = useState(settings.immediate_enabled);
  const [digest, setDigest] = useState(settings.digest_enabled);
  const [hour, setHour] = useState(settings.digest_hour_et);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const list = recipients
      .split(/[,\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    setBusy(true);
    const res = await fetch("/api/settings/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipients: list, immediate_enabled: immediate, digest_enabled: digest, digest_hour_et: hour }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      toast.error("Couldn’t save notification settings", { description: body.error ?? "Check your connection and try again." });
      return;
    }
    toast.success("Notification settings saved", {
      description: `${list.length} recipient${list.length === 1 ? "" : "s"} · ${immediate ? "immediate on" : "immediate off"} · ${digest ? `summary at ${hourLabel(hour)} ET` : "summary off"}`,
    });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex max-w-[620px] flex-col gap-6">
      <label className="flex flex-col gap-1">
        <span className="text-caption text-graphite">Recipients</span>
        <input id="recipients" className={input} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="you@example.com, ops@example.com" />
        <span className="text-legal text-muted">Separate addresses with commas. Up to 10.</span>
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-caption text-graphite">When to email</legend>
        <label className="flex items-start gap-3 rounded-lg border border-line p-4">
          <input id="immediate" type="checkbox" checked={immediate} onChange={(e) => setImmediate(e.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" />
          <span className="flex flex-col gap-0.5">
            <span className="text-body font-semibold text-ink">Critical alerts, as they happen</span>
            <span className="text-caption text-muted">One email within 15 minutes of a number being flagged. Repeats are batched into a single email.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-line p-4">
          <input id="digest" type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" />
          <span className="flex flex-col gap-0.5">
            <span className="text-body font-semibold text-ink">Daily summary</span>
            <span className="text-caption text-muted">Calls, answer rate, pool health and open alerts, once a day.</span>
          </span>
        </label>
      </fieldset>

      <label className="flex max-w-[260px] flex-col gap-1">
        <span className="text-caption text-graphite">Summary time (Eastern)</span>
        <select id="digest-hour" value={hour} disabled={!digest} onChange={(e) => setHour(Number(e.target.value))} className={`${input} disabled:opacity-50`}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 w-fit items-center rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
