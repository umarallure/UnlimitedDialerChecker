"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function ResolveButton({ id, label }: { id: number; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    const res = await fetch(`/api/alerts/${id}/resolve`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) {
      toast.success(`Alert resolved: ${label}`, { description: "If the problem continues, the next health check opens a new alert." });
      router.refresh();
    } else if (res?.status === 409) {
      toast.info("Already resolved", { description: label });
      router.refresh();
    } else {
      toast.error("Couldn’t resolve the alert", { description: body.error ?? "Check your connection and try again." });
    }
  }

  return (
    <button
        type="button"
        onClick={resolve}
        disabled={busy}
        className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong disabled:opacity-60"
      >
        {busy ? "Resolving…" : "Resolve"}
    </button>
  );
}

export function RunChecksButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/alerts/run", { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      toast.error("Health checks didn’t run", { description: body.error ?? "Check your connection and try again." });
      return;
    }
    const opened = body.opened ?? 0;
    const description = `${opened} opened · ${body.resolved ?? 0} resolved · ${body.refreshed ?? 0} still open`;
    if (opened) toast.warning(`${opened} new alert${opened === 1 ? "" : "s"}`, { description });
    else toast.success("Health checks complete", { description });
    router.refresh();
  }

  return (
    <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-60"
      >
        <RefreshCw aria-hidden className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
        {busy ? "Checking…" : "Run checks now"}
    </button>
  );
}
