"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";

type Step = { step: string; ok: boolean; detail?: string };

const control = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";

/**
 * Suggest a campaign id: capitals, numbers and underscore, 8 characters at most.
 *
 * Truncating the front would collide for names that differ only at the end — "agent1" and
 * "agent2" both become AG_AGENT — so the tail is kept, and anything still taken gets a number.
 */
function campaignIdFor(user: string, taken: string[] = []): string {
  const base = user.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const candidate = `AG_${base.length > 5 ? base.slice(-5) : base}`;
  if (!taken.includes(candidate)) return candidate;

  for (let n = 2; n < 100; n++) {
    const next = `${candidate.slice(0, 8 - String(n).length)}${n}`;
    if (!taken.includes(next)) return next;
  }
  return candidate;
}

/**
 * Creates an agent with everything they need: their own campaign, their own list, and a user
 * group that admits them to that campaign alone.
 */
export function NewAgentForm({ nextListId, takenCampaigns = [], onDone }: { nextListId: number; takenCampaigns?: string[]; onDone?: () => void }) {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [listId, setListId] = useState(nextListId);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);

  const effectiveCampaign = campaignId || campaignIdFor(user, takenCampaigns);

  async function create() {
    setBusy(true);
    setSteps(null);

    const res = await fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "create_agent",
        payload: {
          user,
          password,
          fullName: fullName || user,
          campaignId: effectiveCampaign,
          campaignName: `${fullName || user} outbound`,
          listId,
          listName: `${fullName || user} main list`,
        },
      }),
    }).catch(() => null);

    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setBusy(false);
      toast.error("Could not queue", { description: body.error ?? "Check the details and try again." });
      return;
    }

    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const p = await fetch(`/api/commands?id=${body.id}`).catch(() => null);
      if (!p?.ok) continue;
      const cmd = await p.json();
      if (cmd.status !== "done" && cmd.status !== "failed") continue;

      setBusy(false);
      const result = cmd.result as { steps?: Step[]; error?: string };
      setSteps(result.steps ?? null);

      if (cmd.status === "done") {
        toast.success(`${user} is ready`, { description: `Campaign ${effectiveCampaign}, list ${listId}, dialing only their own leads.` });
        setUser("");
        setFullName("");
        setPassword("");
        setCampaignId("");
        setListId(listId + 1);
        router.refresh();
        onDone?.();
      } else {
        const failed = result.steps?.find((s) => !s.ok);
        toast.error("Not finished", { description: failed?.detail ?? result.error ?? "See the steps below." });
      }
      return;
    }

    setBusy(false);
    toast.error("No answer from the dialer", { description: "Check Dialer sync in Settings — its agent may be stopped." });
  }

  const ready = /^[A-Za-z0-9_]{2,20}$/.test(user) && password.length >= 8 && !busy;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Username</span>
          <input className={control} value={user} onChange={(e) => setUser(e.target.value)} placeholder="agent4" autoComplete="off" name="vicidial-user" />
          <span className="text-legal text-muted">Letters, numbers and underscores.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Full name</span>
          <input className={control} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Alex Doe" autoComplete="off" name="vicidial-full-name" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Password</span>
          <input className={control} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 8 characters" autoComplete="new-password" name="vicidial-password" />
          <span className="text-legal text-muted">Set by you and given to the agent; it is not stored in this app.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Campaign id</span>
          <input className={control} value={campaignId} onChange={(e) => setCampaignId(e.target.value.toUpperCase())} placeholder={user ? campaignIdFor(user, takenCampaigns) : "AG_AGENT"} />
          <span className="text-legal text-muted">Capitals and numbers, 8 characters at most.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">List number</span>
          <input className={control} type="number" min={100} value={listId} onChange={(e) => setListId(Number(e.target.value))} />
        </label>
      </div>

      <p className="rounded-lg bg-surface-alt p-4 text-caption text-graphite">
        Creates <strong className="text-ink">{effectiveCampaign || "a campaign"}</strong> from the template, list{" "}
        <strong className="text-ink tabular-nums">{listId}</strong>, and a user group admitting {user || "them"} to that campaign only. The campaign inherits the template’s
        pacing and compliance settings, and dials <strong className="text-ink">only leads this agent owns</strong>.
      </p>

      <button
        type="button"
        onClick={create}
        disabled={!ready}
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover disabled:opacity-60"
      >
        <UserPlus aria-hidden className="size-4" />
        {busy ? "Creating…" : "Create agent"}
      </button>

      {steps && (
        <ul className="flex flex-col gap-1 text-caption">
          {steps.map((s) => (
            <li key={s.step} className={s.ok ? "text-graphite" : "text-error"}>
              {s.ok ? "✓" : "✗"} {s.step}
              {s.detail ? ` — ${s.detail}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
