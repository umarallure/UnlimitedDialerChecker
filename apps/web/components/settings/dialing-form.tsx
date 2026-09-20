"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DIAL_METHODS, type DialMethod, type DialSettings, planCapacity, validateDialPlan } from "@udc/policy";

const METHOD_LABEL: Record<DialMethod, string> = {
  MANUAL: "Manual — one call at a time",
  RATIO: "Ratio — fixed lines per agent",
  ADAPT_HARD_LIMIT: "Predictive, hard limit — never exceeds the drop rate",
  ADAPT_TAPERED: "Predictive, tapered — eases off as the drop rate rises",
  ADAPT_AVERAGE: "Predictive, average — paces on the day's average",
};

const control = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";
const LEVEL_CLASS = { error: "border-error/20 bg-error/10 text-error", warning: "border-warning/20 bg-warning/10 text-warning", info: "border-line bg-surface-alt text-graphite" };

export type DialingFormProps = {
  campaignId: string;
  settings: DialSettings & { plannedAgents: number; reservedLines: number };
  serverTrunks: number | null;
  carrierChannels: number;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-graphite">{label}</span>
      {children}
      {hint && <span className="text-legal text-muted">{hint}</span>}
    </label>
  );
}

export function DialingForm({ campaignId, settings, serverTrunks, carrierChannels }: DialingFormProps) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const capacity = useMemo(
    () => ({
      agents: form.plannedAgents,
      serverTrunks: serverTrunks ?? Number.MAX_SAFE_INTEGER,
      carrierChannels,
      reservedLines: form.reservedLines,
    }),
    [form.plannedAgents, form.reservedLines, serverTrunks, carrierChannels],
  );

  // Validated as you type, with the same functions the server uses to accept or refuse a save.
  const issues = useMemo(() => validateDialPlan(form, capacity), [form, capacity]);
  const plan = useMemo(() => planCapacity(form, capacity), [form, capacity]);
  const blocked = issues.some((i) => i.level === "error");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/settings/dialing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId, ...form }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);

    if (!res?.ok) {
      toast.error("Dialing plan not saved", { description: body.error ?? "Check the values and try again." });
      return;
    }
    toast.success("Dialing plan saved", {
      description:
        form.dialMethod === "MANUAL"
          ? "One call at a time. Nothing has changed on the dialer yet."
          : `${form.linesPerAgent} lines per agent, ${plan.linesNeeded} calls at once with ${form.plannedAgents} agents. Nothing has changed on the dialer yet.`,
    });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Dialing method" hint="Predictive methods place more calls than there are agents and hand over the ones a person answers.">
            <select className={control} value={form.dialMethod} onChange={(e) => set("dialMethod", e.target.value as DialMethod)}>
              {DIAL_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Lines per agent" hint="How many calls run in parallel for each agent on the floor.">
          <input type="number" step="0.1" min="0" max="10" className={control} value={form.linesPerAgent} onChange={(e) => set("linesPerAgent", Number(e.target.value))} />
        </Field>
        <Field label="Never go above" hint="Ceiling the predictive pacing may not pass.">
          <input type="number" step="0.1" min="1" max="10" className={control} value={form.maxLinesPerAgent} onChange={(e) => set("maxLinesPerAgent", Number(e.target.value))} />
        </Field>

        <Field label="Abandoned calls allowed" hint="Capped at 3% a day per campaign by the Telemarketing Sales Rule.">
          <input type="number" step="0.1" min="0" max="3" className={control} value={form.maxDropPct} onChange={(e) => set("maxDropPct", Number(e.target.value))} />
        </Field>
        <Field label="Ring for (seconds)" hint="How long to let a number ring before giving up. 25–40 reads as a normal call.">
          <input type="number" min="10" max="120" className={control} value={form.dialTimeoutSec} onChange={(e) => set("dialTimeoutSec", Number(e.target.value))} />
        </Field>

        <Field label="Seconds before a call counts as abandoned" hint="The rule allows 2 seconds from the customer's greeting.">
          <input type="number" min="1" max="20" className={control} value={form.dropCallSeconds} onChange={(e) => set("dropCallSeconds", Number(e.target.value))} />
        </Field>
        <Field label="Leads kept ready" hint="The hopper VICIdial dials from.">
          <input type="number" min="1" max="2000" className={control} value={form.hopperLevel} onChange={(e) => set("hopperLevel", Number(e.target.value))} />
        </Field>

        <Field label="Agents on the floor" hint="Full staffing, used to size the plan.">
          <input type="number" min="0" max="500" className={control} value={form.plannedAgents} onChange={(e) => set("plannedAgents", Number(e.target.value))} />
        </Field>
        <Field label="Lines held back" hint="Kept free for inbound calls and transfers.">
          <input type="number" min="0" max="500" className={control} value={form.reservedLines} onChange={(e) => set("reservedLines", Number(e.target.value))} />
        </Field>

        <label className="flex items-start gap-3 rounded-lg border border-line p-4 sm:col-span-2">
          <input type="checkbox" checked={form.availableOnlyTally} onChange={(e) => set("availableOnlyTally", e.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" />
          <span className="flex flex-col gap-0.5">
            <span className="text-body font-semibold text-ink">Pace on available agents only</span>
            <span className="text-caption text-muted">Ignores agents who are paused or already on a call, which drops fewer people.</span>
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-lg bg-surface-alt p-4">
        <p className="text-caption text-graphite">
          {form.plannedAgents} agents × {form.linesPerAgent} lines ={" "}
          <strong className="text-ink tabular-nums">{plan.linesNeeded} calls at once</strong>, out of{" "}
          <strong className="text-ink tabular-nums">{serverTrunks === null ? "an unknown number of" : plan.linesAvailable}</strong> free
          {serverTrunks !== null && ` (dialer ${serverTrunks} trunks, carrier ${carrierChannels} channels, ${form.reservedLines} held back)`}.
        </p>
        {serverTrunks === null && <p className="text-legal text-muted">The dialer has not reported its trunk count yet, so only the carrier limit is checked.</p>}
      </div>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {issues.map((i, n) => (
            <li key={`${i.field}-${n}`} className={`rounded-md border px-3.5 py-3 text-caption ${LEVEL_CLASS[i.level]}`}>
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || blocked}
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save plan"}
        </button>
        <span className="text-legal text-muted">{blocked ? "Fix the problems above to save." : "Saving records the plan. It is not sent to the dialer."}</span>
      </div>
    </form>
  );
}
