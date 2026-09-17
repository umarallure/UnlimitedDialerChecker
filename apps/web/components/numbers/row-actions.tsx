"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { runNumberAction } from "@/lib/number-actions";

const btn =
  "relative z-10 inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border border-line bg-surface px-3 text-legal font-semibold text-ink hover:border-line-strong disabled:opacity-50";

/** Inline row actions: finish setup, hold/release in place, open the detail page. */
export function RowActions({
  id,
  label,
  held,
  retired,
  setupComplete,
}: {
  id: string;
  label: string;
  held: boolean;
  retired: boolean;
  setupComplete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleHold() {
    if (!held && !window.confirm(`Hold ${label}? It won’t dial until released.`)) return;
    setBusy(true);
    setError(null);
    try {
      await runNumberAction([id], held ? "release" : "hold", held ? {} : { reason: "Held from numbers list" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-center justify-end gap-2">
        {!setupComplete && !retired && (
          <Link href={`/numbers/${id}?tab=setup`} className={btn}>
            Setup
          </Link>
        )}
        {!retired && (
          <button type="button" onClick={() => void toggleHold()} disabled={busy} className={btn} aria-label={`${held ? "Release" : "Hold"} ${label}`}>
            {busy ? "…" : held ? "Release" : "Hold"}
          </button>
        )}
        <Link href={`/numbers/${id}`} className={`${btn} border-ink bg-ink text-on-dark hover:bg-graphite`} aria-label={`Manage ${label}`}>
          Manage
        </Link>
      </span>
      {error && <span className="text-legal text-error">{error}</span>}
    </span>
  );
}
