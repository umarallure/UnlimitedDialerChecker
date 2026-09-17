"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { describeAction } from "@/lib/action-messages";
import { runNumberAction, type ActionPayload, type NumberAction } from "@/lib/number-actions";

type Ctx = { selected: Set<string>; toggle: (id: string) => void; setAll: (on: boolean) => void; ids: string[] };
const SelectionContext = createContext<Ctx | null>(null);

function useSelection() {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside NumberSelection");
  return ctx;
}

export function NumberSelection({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const value = useMemo<Ctx>(
    () => ({
      selected,
      ids,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setAll: (on) => setSelected(on ? new Set(ids) : new Set()),
    }),
    [selected, ids],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <label className="relative z-10 flex size-11 cursor-pointer items-center justify-center">
      <span className="sr-only">Select {label}</span>
      <input id={`select-${id}`} type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} className="size-4 accent-[var(--color-primary)]" />
    </label>
  );
}

const BULK: { action: NumberAction; label: string; payload: ActionPayload; confirm?: string }[] = [
  { action: "set_fcr", label: "Mark registered", payload: { value: true } },
  { action: "set_callback", label: "Mark callback verified", payload: { value: true } },
  { action: "set_attestation", label: "Attestation A", payload: { value: "A" } },
  { action: "hold", label: "Hold", payload: { reason: "Bulk hold" }, confirm: "Hold the selected numbers? They won’t dial until released." },
  { action: "release", label: "Release", payload: {} },
];

export function BulkBar() {
  const router = useRouter();
  const { selected, setAll, ids } = useSelection();
  const [busy, setBusy] = useState<NumberAction | null>(null);
  const count = selected.size;
  const allSelected = count > 0 && count === ids.length;

  async function run(item: (typeof BULK)[number]) {
    if (item.confirm && !window.confirm(item.confirm)) return;
    setBusy(item.action);
    try {
      const r = await runNumberAction([...selected], item.action, item.payload);
      const msg = describeAction(item.action, item.payload, r);
      if (msg.noop) toast.info(msg.title, { description: msg.description });
      else toast.success(msg.title, { description: msg.description });
      router.refresh();
    } catch (e) {
      toast.error(`Couldn’t apply “${item.label}” to ${selected.size} numbers`, { description: e instanceof Error ? e.message : "Nothing was changed. Try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-caption text-graphite">
        <input id="select-all-numbers" type="checkbox" checked={allSelected} onChange={(e) => setAll(e.target.checked)} disabled={ids.length === 0} className="size-4 accent-[var(--color-primary)]" />
        {count ? `${count} selected` : `Select all ${ids.length}`}
      </label>
      {count > 0 && (
        <>
          <span aria-hidden className="h-6 w-px bg-line" />
          {BULK.map((item) => (
            <button
              key={item.action}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(item)}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong disabled:opacity-50"
            >
              {busy === item.action ? "Saving…" : item.label}
            </button>
          ))}
          <button type="button" onClick={() => setAll(false)} className="inline-flex min-h-11 items-center gap-1 px-2 text-button text-graphite hover:text-ink">
            <X aria-hidden className="size-4" /> Clear
          </button>
        </>
      )}
    </div>
  );
}
