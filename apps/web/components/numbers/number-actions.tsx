"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { runNumberAction, setupChecklist, type ActionPayload, type NumberAction } from "@/lib/number-actions";

export type PanelDid = {
  id: string;
  lifecycle: string;
  manual_hold: boolean;
  manual_hold_reason: string | null;
  fcr_registered_at: string | null;
  inbound_route_ok: boolean;
  attestation: string | null;
  cnam: string | null;
  notes: string | null;
  cap_override: number | null;
  daily_cap: number;
};

const chip =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50";
const input =
  "min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink placeholder:text-muted focus:border-ink focus:outline-none";

type Message = { tone: "ok" | "error"; text: string } | null;

function useNumberAction(didId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  async function run(key: string, action: NumberAction, payload: ActionPayload, success: string) {
    setBusy(key);
    setMessage(null);
    try {
      const r = await runNumberAction([didId], action, payload);
      setMessage({ tone: "ok", text: r.changed ? success : "No change needed." });
      router.refresh();
      return true;
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Action failed." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, message, run };
}

function StatusLine({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role="status" className={`text-caption ${message.tone === "ok" ? "text-success" : "text-error"}`}>
      {message.text}
    </p>
  );
}

/** Setup as ordered steps: register, verify callback, confirm attestation, then optional CNAM. */
export function SetupSteps({ did }: { did: PanelDid }) {
  const { busy, message, run } = useNumberAction(did.id);
  const steps = setupChecklist(did);
  const requiredDone = steps.filter((s) => s.required).every((s) => s.done);

  const help: Record<string, string> = {
    fcr: "Submit the number at freecallerregistry.com so Hiya, TNS and First Orion know it belongs to your business.",
    callback: "Call the number from any phone and confirm it reaches the IVR that names the business and takes do-not-call requests.",
    attestation: "Confirm with Teleinx that calls from this number are signed with A-level STIR/SHAKEN attestation.",
    cnam: "The caller name shown on landlines and some carriers. Up to 15 characters.",
  };

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={step.key} className={`flex flex-col gap-3 rounded-lg border p-5 sm:flex-row sm:items-center ${step.done ? "border-line bg-surface" : "border-line-strong bg-surface"}`}>
            <span
              aria-hidden
              className={`flex size-9 shrink-0 items-center justify-center rounded-full text-button ${step.done ? "bg-success text-on-primary" : "bg-surface-alt text-graphite"}`}
            >
              {step.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-body font-semibold text-ink">
                {step.label}
                {!step.required && <span className="font-normal text-muted"> · optional</span>}
              </span>
              <span className="text-caption text-muted">{help[step.key]}</span>
            </span>
            <span className="shrink-0">
              {step.key === "fcr" && (
                <button type="button" className={chip} disabled={busy !== null} onClick={() => run("fcr", "set_fcr", { value: !step.done }, step.done ? "Registration cleared." : "Marked registered.")}>
                  {busy === "fcr" ? "Saving…" : step.done ? "Undo" : "Mark done"}
                </button>
              )}
              {step.key === "callback" && (
                <button type="button" className={chip} disabled={busy !== null} onClick={() => run("callback", "set_callback", { value: !step.done }, step.done ? "Callback marked not working." : "Callback verified.")}>
                  {busy === "callback" ? "Saving…" : step.done ? "Undo" : "Mark done"}
                </button>
              )}
              {step.key === "attestation" && (
                <label className="flex items-center gap-2 text-caption text-graphite">
                  <span className="sr-only">Attestation</span>
                  <select
                    id={`attestation-${did.id}`}
                    value={did.attestation ?? ""}
                    disabled={busy !== null}
                    onChange={(e) => run("attestation", "set_attestation", { value: e.target.value }, "Attestation saved.")}
                    className="min-h-11 rounded-full border border-line bg-surface px-4 text-button text-ink"
                  >
                    <option value="">Unknown</option>
                    <option value="A">A · full</option>
                    <option value="B">B · partial</option>
                    <option value="C">C · gateway</option>
                  </select>
                </label>
              )}
              {step.key === "cnam" && <span className="text-caption text-graphite">{did.cnam ?? "Set it on the Actions tab"}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className={`rounded-lg p-4 text-caption ${requiredDone ? "bg-success/10 text-success" : "bg-surface-alt text-graphite"}`}>
        {requiredDone
          ? did.lifecycle === "NEW"
            ? "Setup complete. The number can start warming up after 7 days of aging."
            : "Setup complete."
          : "Finish the three required steps before this number starts warming up."}
      </div>
      <StatusLine message={message} />
    </div>
  );
}

type Pending = { action: NumberAction; title: string; body: string; requireReason: boolean; confirm: string; danger?: boolean };

/** Hold/release, cool off, start warm-up and retire, each confirmed inline. */
export function LifecycleActions({ did, setupComplete }: { did: PanelDid; setupComplete: boolean }) {
  const { busy, message, run } = useNumberAction(did.id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");

  const canCool = did.lifecycle === "WARMING" || did.lifecycle === "ACTIVE";
  const canWarm = did.lifecycle === "COOLING" || did.lifecycle === "NEW";

  const options: Array<{ show: boolean; label: string; description: string; pending?: Pending; direct?: () => void; danger?: boolean }> = [
    {
      show: !did.manual_hold && did.lifecycle !== "RETIRED",
      label: "Hold",
      description: "Stop dialing from this number until you release it. Lifecycle stays the same.",
      pending: { action: "hold", title: "Hold this number", body: "It won’t be used for outbound calls until released.", requireReason: false, confirm: "Hold number" },
    },
    {
      show: did.manual_hold,
      label: "Release hold",
      description: `Currently held${did.manual_hold_reason ? `: ${did.manual_hold_reason}` : ""}.`,
      direct: () => void run("release", "release", {}, "Released from hold."),
    },
    {
      show: canCool,
      label: "Cool off",
      description: "Rest the number for 7–14 days. Use it when a number gets flagged or its answer rate drops.",
      pending: { action: "force_cool", title: "Start a cool-off now", body: "Outbound calls stop; inbound callbacks keep working.", requireReason: false, confirm: "Start cool-off" },
    },
    {
      show: canWarm,
      label: "Start warm-up",
      description: "Begin the 20 → 40 → 60 calls/day ramp now instead of waiting for the automatic schedule.",
      pending: {
        action: "restart_warmup",
        title: "Start warm-up now",
        body: setupComplete ? "The number starts at 20 calls a day." : "Setup isn’t complete. Warming up an unregistered number risks early spam labels.",
        requireReason: false,
        confirm: "Start warm-up",
      },
    },
    {
      show: did.lifecycle !== "RETIRED",
      label: "Retire",
      description: "Stop using the number for good. Keep callbacks routed for 90 days before releasing it.",
      danger: true,
      pending: { action: "retire", title: "Retire this number", body: "This can’t be undone from the app.", requireReason: true, confirm: "Retire number", danger: true },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {options
        .filter((o) => o.show)
        .map((o) => (
          <div key={o.label} className="flex flex-col gap-3 rounded-lg border border-line p-4 sm:flex-row sm:items-center">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={`text-body font-semibold ${o.danger ? "text-error" : "text-ink"}`}>{o.label}</span>
              <span className="text-caption text-muted">{o.description}</span>
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => (o.direct ? o.direct() : (setPending(o.pending!), setReason("")))}
              className={`${chip} shrink-0 ${o.danger ? "text-error hover:border-error/40" : ""}`}
            >
              {o.label}
            </button>
          </div>
        ))}

      {pending && (
        <form
          className="flex flex-col gap-3 rounded-lg bg-surface-alt p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending.requireReason && !reason.trim()) return;
            const ok = await run(pending.action, pending.action, { reason: reason.trim() || undefined }, `${pending.confirm}: done.`);
            if (ok) setPending(null);
          }}
        >
          <p className="text-body font-semibold text-ink">{pending.title}</p>
          <p className={`text-caption ${pending.action === "restart_warmup" && !setupComplete ? "text-warning" : "text-muted"}`}>{pending.body}</p>
          <label className="flex flex-col gap-1 text-caption text-graphite">
            Reason{pending.requireReason ? "" : " (optional)"}
            <input id={`reason-${did.id}`} className={input} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Labeled spam on Verizon" autoFocus />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy !== null || (pending.requireReason && !reason.trim())}
              className={`inline-flex min-h-11 items-center rounded-full px-5 text-button text-on-primary disabled:opacity-50 ${pending.danger ? "bg-error hover:bg-error/90" : "bg-ink hover:bg-graphite"}`}
            >
              {busy ? "Saving…" : pending.confirm}
            </button>
            <button type="button" className={chip} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <StatusLine message={message} />
    </div>
  );
}

/** Cap override, CNAM and notes. */
export function DetailsForm({ did }: { did: PanelDid }) {
  const { busy, message, run } = useNumberAction(did.id);
  const [cnam, setCnam] = useState(did.cnam ?? "");
  const [notes, setNotes] = useState(did.notes ?? "");
  const [cap, setCap] = useState(did.cap_override?.toString() ?? "");

  return (
    <div className="flex flex-col gap-5">
      <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); void run("cap", "set_cap_override", { value: cap === "" ? null : Number(cap) }, cap === "" ? "Cap override removed." : "Cap override saved."); }}>
        <label htmlFor={`cap-${did.id}`} className="text-caption text-graphite">
          Daily cap override <span className="text-muted">(lifecycle cap is {did.daily_cap})</span>
        </label>
        <div className="flex gap-2">
          <input id={`cap-${did.id}`} type="number" min={0} max={500} inputMode="numeric" className={input} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Use lifecycle cap" />
          <button type="submit" className={chip} disabled={busy !== null}>{busy === "cap" ? "Saving…" : "Save"}</button>
        </div>
      </form>
      <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); void run("cnam", "set_cnam", { value: cnam }, "CNAM saved."); }}>
        <label htmlFor={`cnam-${did.id}`} className="text-caption text-graphite">
          Caller name (CNAM, 15 characters)
        </label>
        <div className="flex gap-2">
          <input id={`cnam-${did.id}`} maxLength={15} className={input} value={cnam} onChange={(e) => setCnam(e.target.value.toUpperCase())} placeholder="COMPANY NAME" />
          <button type="submit" className={chip} disabled={busy !== null}>{busy === "cnam" ? "Saving…" : "Save"}</button>
        </div>
      </form>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void run("notes", "set_notes", { value: notes }, "Notes saved."); }}>
        <label htmlFor={`notes-${did.id}`} className="text-caption text-graphite">
          Notes
        </label>
        <textarea id={`notes-${did.id}`} rows={4} maxLength={500} className={`${input} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button type="submit" className={`${chip} self-start`} disabled={busy !== null}>{busy === "notes" ? "Saving…" : "Save notes"}</button>
      </form>
      <StatusLine message={message} />
    </div>
  );
}
