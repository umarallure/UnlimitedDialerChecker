"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle } from "lucide-react";
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

type Pending = { action: NumberAction; title: string; requireReason: boolean; confirm: string; danger?: boolean };

export function NumberActions({ did }: { did: PanelDid }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [cnam, setCnam] = useState(did.cnam ?? "");
  const [notes, setNotes] = useState(did.notes ?? "");
  const [cap, setCap] = useState(did.cap_override?.toString() ?? "");

  async function run(key: string, action: NumberAction, payload: ActionPayload, success: string) {
    setBusy(key);
    setMessage(null);
    try {
      const r = await runNumberAction([did.id], action, payload);
      setMessage({ tone: "ok", text: r.changed ? success : "No change needed." });
      setPending(null);
      setReason("");
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Action failed." });
    } finally {
      setBusy(null);
    }
  }

  const checklist = setupChecklist(did);
  const canCool = did.lifecycle === "WARMING" || did.lifecycle === "ACTIVE";
  const canWarm = did.lifecycle === "COOLING" || did.lifecycle === "NEW";
  const requiredDone = checklist.filter((c) => c.required).every((c) => c.done);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-title-sm font-bold text-ink">Setup checklist</h3>
        <ul className="flex flex-col gap-2">
          {checklist.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <span className="flex items-center gap-2 text-caption">
                {item.done ? (
                  <Check aria-hidden className="size-4 shrink-0 text-success" strokeWidth={2.5} />
                ) : (
                  <Circle aria-hidden className="size-4 shrink-0 text-line-strong" />
                )}
                <span className={item.done ? "text-ink" : "text-graphite"}>
                  {item.label}
                  {!item.required && <span className="text-muted"> (optional)</span>}
                </span>
              </span>
              {item.key === "fcr" && (
                <button type="button" className={chip} disabled={busy !== null} onClick={() => run("fcr", "set_fcr", { value: !item.done }, item.done ? "Registration cleared." : "Marked registered.")}>
                  {busy === "fcr" ? "Saving…" : item.done ? "Undo" : "Mark done"}
                </button>
              )}
              {item.key === "callback" && (
                <button type="button" className={chip} disabled={busy !== null} onClick={() => run("callback", "set_callback", { value: !item.done }, item.done ? "Callback marked not working." : "Callback verified.")}>
                  {busy === "callback" ? "Saving…" : item.done ? "Undo" : "Mark done"}
                </button>
              )}
              {item.key === "attestation" && (
                <label className="flex items-center gap-2">
                  <span className="sr-only">Attestation</span>
                  <select
                    id={`attestation-${did.id}`}
                    value={did.attestation ?? ""}
                    disabled={busy !== null}
                    onChange={(e) => run("attestation", "set_attestation", { value: e.target.value }, "Attestation saved.")}
                    className="min-h-11 rounded-full border border-line bg-surface px-3 text-button text-ink"
                  >
                    <option value="">Unknown</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </select>
                </label>
              )}
              {item.key === "cnam" && <span className="text-legal text-muted">{did.cnam ?? "Not set"}</span>}
            </li>
          ))}
        </ul>
        {did.lifecycle === "NEW" && (
          <p className="text-legal text-muted">
            {requiredDone ? "Setup complete. The number can start warming up after 7 days of aging." : "Complete the required steps before this number can start warming up."}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-title-sm font-bold text-ink">Actions</h3>
        {did.manual_hold && (
          <p className="rounded-md border border-error/20 bg-error/10 px-3 py-2 text-caption text-error">
            Held{did.manual_hold_reason ? `: ${did.manual_hold_reason}` : ""}. It won’t dial until released.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {did.manual_hold ? (
            <button type="button" className={chip} disabled={busy !== null} onClick={() => run("release", "release", {}, "Released from hold.")}>
              {busy === "release" ? "Releasing…" : "Release hold"}
            </button>
          ) : (
            <button type="button" className={chip} disabled={busy !== null || did.lifecycle === "RETIRED"} onClick={() => setPending({ action: "hold", title: "Hold this number", requireReason: false, confirm: "Hold number" })}>
              Hold
            </button>
          )}
          {canCool && (
            <button type="button" className={chip} disabled={busy !== null} onClick={() => setPending({ action: "force_cool", title: "Start a cool-off now", requireReason: false, confirm: "Start cool-off" })}>
              Cool off
            </button>
          )}
          {canWarm && (
            <button type="button" className={chip} disabled={busy !== null} onClick={() => setPending({ action: "restart_warmup", title: "Start warm-up now", requireReason: false, confirm: "Start warm-up" })}>
              Start warm-up
            </button>
          )}
          {did.lifecycle !== "RETIRED" && (
            <button
              type="button"
              className={`${chip} text-error hover:border-error/40`}
              disabled={busy !== null}
              onClick={() => setPending({ action: "retire", title: "Retire this number", requireReason: true, confirm: "Retire number", danger: true })}
            >
              Retire
            </button>
          )}
        </div>

        {pending && (
          <form
            className="flex flex-col gap-3 rounded-lg bg-surface-alt p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (pending.requireReason && !reason.trim()) return;
              void run(pending.action, pending.action, { reason: reason.trim() || undefined }, `${pending.confirm}: done.`);
            }}
          >
            <p className="text-caption font-semibold text-ink">{pending.title}</p>
            {pending.action === "retire" && <p className="text-legal text-muted">Retired numbers stop dialing for good. Keep callbacks routed for 90 days before releasing the number.</p>}
            {pending.action === "restart_warmup" && did.lifecycle === "NEW" && !requiredDone && (
              <p className="text-legal text-warning">Setup isn’t complete. Warming up an unregistered number risks early spam labels.</p>
            )}
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
              <button type="button" className={chip} onClick={() => { setPending(null); setReason(""); }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-title-sm font-bold text-ink">Details</h3>
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
        <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); void run("notes", "set_notes", { value: notes }, "Notes saved."); }}>
          <label htmlFor={`notes-${did.id}`} className="text-caption text-graphite">
            Notes
          </label>
          <textarea id={`notes-${did.id}`} rows={3} maxLength={500} className={`${input} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="submit" className={`${chip} self-start`} disabled={busy !== null}>{busy === "notes" ? "Saving…" : "Save notes"}</button>
        </form>
      </section>

      {message && (
        <p role="status" className={`text-caption ${message.tone === "ok" ? "text-success" : "text-error"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
