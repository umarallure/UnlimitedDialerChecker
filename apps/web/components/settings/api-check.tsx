"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlugZap } from "lucide-react";
import { toast } from "sonner";

type CommandResult = { version?: string; campaigns?: string[]; error?: string; step?: string };

/**
 * Queues an api_ping and follows it until the dialer finishes it.
 * Polling rather than Realtime: this runs for a few seconds after a click, and a socket for
 * that is more moving parts than the job needs.
 */
export function ApiCheckButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function wait(id: string): Promise<{ status: string; result: CommandResult | null }> {
    // The agent polls its queue every 3 seconds, so give it a couple of cycles.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`/api/commands?id=${id}`).catch(() => null);
      if (!res?.ok) continue;
      const body = await res.json();
      if (body.status === "done" || body.status === "failed") return body;
    }
    return { status: "timeout", result: null };
  }

  async function run() {
    setBusy(true);
    setResult(null);

    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "api_ping" }),
    }).catch(() => null);

    if (!res?.ok) {
      setBusy(false);
      toast.error("Couldn’t queue the check", { description: (await res?.json().catch(() => ({})))?.error ?? "Check your connection." });
      return;
    }

    const { id } = await res.json();
    const finished = await wait(id);
    setBusy(false);

    if (finished.status === "timeout") {
      setResult({ ok: false, text: "The dialer did not pick this up. Its agent may be stopped — check Dialer sync above." });
      toast.error("No answer from the dialer");
      return;
    }
    if (finished.status === "failed") {
      const r = finished.result ?? {};
      setResult({ ok: false, text: `${r.error ?? "Unknown error"}${r.step ? ` (during ${r.step})` : ""}` });
      toast.error("The dialer could not reach VICIdial");
      return;
    }

    const r = finished.result ?? {};
    const campaigns = r.campaigns?.length ? `, campaigns: ${r.campaigns.join(", ")}` : "";
    setResult({ ok: true, text: `${r.version ?? "connected"}${campaigns}` });
    toast.success("VICIdial answered");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong disabled:opacity-60"
      >
        <PlugZap aria-hidden className="size-4" />
        {busy ? "Asking the dialer…" : "Check VICIdial connection"}
      </button>

      {result && (
        <p className={`rounded-md border px-3.5 py-3 text-caption ${result.ok ? "border-success/20 bg-success/10 text-success" : "border-error/20 bg-error/10 text-error"}`}>
          {result.text}
        </p>
      )}

      <p className="text-legal text-muted">
        Queues a command for the dialer, which calls the VICIdial API over its own loopback and reports back. The API is closed to the internet, so this is the only route to it.
      </p>
    </div>
  );
}
