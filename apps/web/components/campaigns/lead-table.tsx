"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, PackageOpen, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export type Lead = {
  lead_id: number;
  owner: string | null;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  state: string | null;
  phone_last4: string | null;
  called_count: number;
  last_call_at: string | null;
  entry_date: string | null;
};

export type AgentChoice = { user_name: string; full_name: string | null; listId: number | null };

/**
 * The leads in a campaign, and the three things you do with them over time:
 * take some out, put called ones back in the queue, or hand them to someone else.
 */
export function LeadTable({ leads, agents, dialableStatuses }: { leads: Lead[]; agents: AgentChoice[]; dialableStatuses: string[] }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [handTo, setHandTo] = useState("");

  const toggle = (id: number) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChosen = leads.length > 0 && chosen.size === leads.length;

  async function act(action: "park" | "requeue" | "reassign", extra: { owner?: string; listId?: number } = {}) {
    if (chosen.size === 0) return;
    setBusy(true);

    const res = await fetch("/api/leads/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadIds: [...chosen], action, ...extra }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};

    if (!res?.ok) {
      setBusy(false);
      toast.error("Not sent", { description: body.error ?? "Check your connection and try again." });
      return;
    }

    // Follow the command so the toast reports what happened rather than what was asked for.
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const p = await fetch(`/api/commands?id=${body.id}`).catch(() => null);
      if (!p?.ok) continue;
      const cmd = await p.json();
      if (cmd.status !== "done" && cmd.status !== "failed") continue;

      setBusy(false);
      const result = cmd.result as { changed?: number; failed?: number; error?: string };
      if (cmd.status === "done") {
        const what = action === "park" ? "taken out of the campaign" : action === "requeue" ? "back in the queue" : "handed over";
        toast.success(`${result.changed} lead${result.changed === 1 ? "" : "s"} ${what}`, {
          description: "The list here updates on the next sync, within 15 minutes.",
        });
      } else {
        toast.error("Some leads did not change", { description: result.error ?? `${result.failed} failed of ${chosen.size}` });
      }
      setChosen(new Set());
      router.refresh();
      return;
    }

    setBusy(false);
    toast.error("No answer from the dialer", { description: "Check Dialer sync in Settings." });
  }

  return (
    <div className="flex flex-col">
      {chosen.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-alt px-6 py-3">
          <span className="text-caption font-semibold text-ink tabular-nums">{chosen.size} selected</span>

          <button
            type="button"
            disabled={busy}
            onClick={() => act("park")}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong disabled:opacity-60"
          >
            <PackageOpen aria-hidden className="size-4" /> Take out of the campaign
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => act("requeue")}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong disabled:opacity-60"
          >
            <RotateCcw aria-hidden className="size-4" /> Dial again
          </button>

          <span className="flex items-center gap-2">
            <select
              value={handTo}
              onChange={(e) => setHandTo(e.target.value)}
              className="h-11 rounded-md border border-line bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none"
            >
              <option value="">Hand over to…</option>
              {agents
                .filter((a) => a.listId)
                .map((a) => (
                  <option key={a.user_name} value={a.user_name}>
                    {a.full_name || a.user_name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={busy || !handTo}
              onClick={() => {
                const agent = agents.find((a) => a.user_name === handTo);
                if (agent?.listId) void act("reassign", { owner: agent.user_name, listId: agent.listId });
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong disabled:opacity-40"
            >
              <ArrowRightLeft aria-hidden className="size-4" /> Move
            </button>
          </span>

          <button type="button" onClick={() => setChosen(new Set())} className="ml-auto min-h-11 px-2 text-button text-graphite hover:text-ink">
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-caption" style={{ minWidth: 820 }}>
          <thead>
            <tr className="border-b border-line bg-surface-alt text-left">
              <th className="w-12 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label="Select every lead shown"
                  checked={allChosen}
                  onChange={(e) => setChosen(e.target.checked ? new Set(leads.map((l) => l.lead_id)) : new Set())}
                  className="size-4 accent-[var(--color-primary)]"
                />
              </th>
              <th className="px-3 py-3 font-medium text-graphite">Lead</th>
              <th className="px-3 py-3 font-medium text-graphite">State</th>
              <th className="px-3 py-3 font-medium text-graphite">Owner</th>
              <th className="px-3 py-3 font-medium text-graphite">Status</th>
              <th className="px-3 py-3 font-medium text-graphite">Calls</th>
              <th className="px-3 py-3 font-medium text-graphite">Added</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0">
            {leads.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-muted">
                  No leads here yet. Import some from the Leads page.
                </td>
              </tr>
            )}
            {leads.map((l) => {
              const dialable = l.status ? dialableStatuses.includes(l.status) : false;
              return (
                <tr key={l.lead_id} className={chosen.has(l.lead_id) ? "bg-surface-alt" : undefined}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select lead ${l.lead_id}`}
                      checked={chosen.has(l.lead_id)}
                      onChange={() => toggle(l.lead_id)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex flex-col">
                      <span className="font-semibold text-ink">{[l.first_name, l.last_name].filter(Boolean).join(" ") || `Lead ${l.lead_id}`}</span>
                      <span className="text-legal text-muted tabular-nums">•••• {l.phone_last4 ?? "????"}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3">{l.state ?? "—"}</td>
                  <td className="px-3 py-3">{l.owner ?? <span className="text-muted">open</span>}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-legal font-semibold ${dialable ? "border-success/20 bg-success/10 text-success" : "border-line bg-surface-alt text-graphite"}`}>
                      {l.status ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{l.called_count}</td>
                  <td className="px-3 py-3 tabular-nums">{l.entry_date ? new Date(l.entry_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
