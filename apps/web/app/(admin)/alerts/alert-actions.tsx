"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function ResolveButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok && res.status !== 409) setError(body.error ?? "Couldn’t resolve.");
    else router.refresh();
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={resolve}
        disabled={busy}
        className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong disabled:opacity-60"
      >
        {busy ? "Resolving…" : "Resolve"}
      </button>
      {error && <span className="text-legal text-error">{error}</span>}
    </span>
  );
}

export function RunChecksButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/alerts/run", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setResult(body.error ?? "Checks failed to run.");
    else {
      setResult(`${body.opened ?? 0} opened · ${body.resolved ?? 0} resolved · ${body.refreshed ?? 0} still open`);
      router.refresh();
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-3">
      {result && <span className="text-caption text-muted">{result}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-60"
      >
        <RefreshCw aria-hidden className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
        {busy ? "Checking…" : "Run checks now"}
      </button>
    </span>
  );
}
