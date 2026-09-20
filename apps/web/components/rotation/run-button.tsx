"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";

/** Runs the engine in preview and refreshes the page with the new proposals. */
export function RunPreviewButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/rotation/run", { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);

    if (!res?.ok) {
      toast.error("The preview could not run", { description: body.error ?? "Check your connection and try again." });
      return;
    }
    const n = body.proposals as number;
    toast.success(n === 0 ? "Preview complete — nothing due" : `Preview complete — ${n} change${n === 1 ? "" : "s"} proposed`, {
      description: `${body.evaluated} number${body.evaluated === 1 ? "" : "s"} evaluated. Nothing was changed on the dialer.`,
    });
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-60"
    >
      <Play aria-hidden className="size-4" />
      {busy ? "Running…" : "Run preview"}
    </button>
  );
}
