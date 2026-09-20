"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * The one rotation switch that matters while no reputation provider is connected:
 * whether a number must pass a clean scan before it starts warming up.
 */
export function ReputationGateForm({ required, scannedNumbers }: { required: boolean; scannedNumbers: number }) {
  const router = useRouter();
  const [on, setOn] = useState(required);
  const [busy, setBusy] = useState(false);

  async function save(next: boolean) {
    setOn(next);
    setBusy(true);
    const res = await fetch("/api/settings/policy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireCleanReputation: next }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);

    if (!res?.ok) {
      setOn(!next);
      toast.error("Couldn’t change the reputation gate", { description: body.error ?? "Check your connection and try again." });
      return;
    }
    toast.success(next ? "Reputation checks required" : "Reputation checks off", {
      description: next
        ? "Numbers now wait for a clean scan before they warm up."
        : "Numbers may warm up without a scan. A known spam label still holds a number back.",
    });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-start gap-3 rounded-lg border border-line p-4">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => save(e.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" />
        <span className="flex flex-col gap-0.5">
          <span className="text-body font-semibold text-ink">Require a clean reputation scan before warm-up</span>
          <span className="text-caption text-muted">
            With this on, a number stays in aging until a scan comes back clean — and nothing can be scanned until a reputation provider is connected.
          </span>
        </span>
      </label>

      {!on && (
        <p className="rounded-md border border-warning/20 bg-warning/10 p-3 text-caption text-warning">
          Numbers are warming up without a spam-label check. Turn this back on once My Call Score is connected.
        </p>
      )}

      <p className="text-legal text-muted">
        {scannedNumbers === 0 ? "No number has ever been scanned." : `${scannedNumbers} number${scannedNumbers === 1 ? " has" : "s have"} been scanned at least once.`} A number
        with a known spam or scam label is held back either way.
      </p>
    </div>
  );
}
