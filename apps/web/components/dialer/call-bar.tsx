"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneOff, PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

/**
 * The agent's call bar: what is happening, and the handful of things they do about it.
 *
 * State is read from `agents_live`, our mirror of VICIdial's own live agent table, rather than
 * asked of VICIdial directly — the dialer agent already syncs it, and RLS limits an agent to
 * their own row. Commands go the other way, through our server, which resolves *which* agent
 * session to act on from the signed-in user rather than from anything this component sends.
 */

export type Disposition = { status: string; name: string; sale: boolean; dnc: boolean; callback: boolean };

type Live = {
  status: string | null;
  pause_code: string | null;
  lead_id: number | null;
  calls_today: number | null;
  state_since: string | null;
  updated_at: string | null;
};

type Lead = { lead_id: number; first_name: string | null; last_name: string | null; state: string | null; phone_last4: string | null; status: string | null; called_count: number | null };

const POLL_MS = 1500;
/** Past this, the mirror is stale and the bar should say so rather than show old state. */
const STALE_MS = 15_000;

/** VICIdial's statuses, in the words an agent would use. */
const STATUS_LABEL: Record<string, string> = {
  READY: "Waiting for a call",
  CLOSER: "Waiting for a call",
  INCALL: "On a call",
  QUEUE: "Connecting",
  PAUSED: "Paused",
  DISPO: "Choose an outcome",
  PAUSE: "Paused",
};

/**
 * What to call the state the agent is in.
 *
 * VICIdial parks an agent in PAUSED once a call ends and they still owe it an outcome — the same
 * status as an agent taking a breather between calls. Saying "Paused" at that moment is wrong at
 * exactly the point the agent needs prompting, so a lead still attached tells the two apart.
 */
function label(status: string | null, leadId: number | null): string {
  if ((status === "PAUSED" || status === "PAUSE") && leadId) return "Choose an outcome";
  return STATUS_LABEL[status ?? ""] ?? status ?? "Signing in…";
}

function tone(status: string | null, leadId: number | null = null): string {
  if ((status === "PAUSED" || status === "PAUSE") && leadId) return "bg-soft-orange text-primary-pressed border-primary/20";
  if (status === "INCALL" || status === "QUEUE") return "bg-success/10 text-success border-success/20";
  if (status === "DISPO") return "bg-soft-orange text-primary-pressed border-primary/20";
  if (status === "READY" || status === "CLOSER") return "bg-surface-alt text-graphite border-line";
  return "bg-warning/10 text-warning border-warning/20";
}

function elapsed(since: string | null, now: number): string {
  if (!since) return "";
  const s = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CallBar({ dispositions }: { dispositions: Disposition[] }) {
  const [live, setLive] = useState<Live | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [number, setNumber] = useState("");
  const leadIdRef = useRef<number | null>(null);

  // Live state, polled. Cheap: one row, and the page is only open while an agent is working.
  useEffect(() => {
    const supabase = createClient();
    let stopped = false;

    const read = async () => {
      const { data } = await supabase
        .from("agents_live")
        .select("status, pause_code, lead_id, calls_today, state_since, updated_at")
        .maybeSingle();
      if (!stopped) setLive((data as Live) ?? null);
    };

    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  // The lead on screen follows whatever VICIdial says the agent is on.
  useEffect(() => {
    const id = live?.lead_id ?? null;
    if (id === leadIdRef.current) return;
    leadIdRef.current = id;

    let cancelled = false;
    (async () => {
      if (!id) {
        if (!cancelled) setLead(null);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("dialer_leads")
        .select("lead_id, first_name, last_name, state, phone_last4, status, called_count")
        .eq("lead_id", id)
        .maybeSingle();
      if (!cancelled) setLead((data as Lead) ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [live?.lead_id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const send = useCallback(async (fn: string, params: Record<string, string> = {}) => {
    setBusy(true);
    const res = await fetch("/api/agent/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ function: fn, ...params }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);

    if (!res?.ok) {
      toast.error("The dialer did not accept that", { description: body.error ?? "Try again in a moment." });
      return false;
    }
    return true;
  }, []);

  const status = live?.status ?? null;
  const paused = status === "PAUSED" || status === "PAUSE";
  const onCall = status === "INCALL" || status === "QUEUE";
  const stale = !live?.updated_at || now - new Date(live.updated_at).getTime() > STALE_MS;

  const dial = async () => {
    const digits = number.replace(/\D/g, "");
    if (digits.length < 10) {
      toast.error("That number is too short", { description: "Give all ten digits." });
      return;
    }
    if (await send("external_dial", { value: digits, search: "YES", preview: "NO", focus: "YES" })) {
      setNumber("");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface p-6">
        <div className="flex items-center gap-4">
          <span className={`inline-flex min-h-11 items-center rounded-full border px-4 text-button ${tone(status, live?.lead_id ?? null)}`}>
            {stale ? "Not connected" : label(status, live?.lead_id ?? null)}
          </span>
          {!stale && status && <span className="text-title-md tabular-nums text-ink">{elapsed(live?.state_since ?? null, now)}</span>}
          {live?.pause_code && <span className="text-caption text-muted">{live.pause_code}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-caption text-muted tabular-nums">{live?.calls_today ?? 0} calls today</span>
          <button
            type="button"
            disabled={busy || stale}
            onClick={() => send("external_pause", { value: paused ? "RESUME" : "PAUSE" })}
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong disabled:opacity-60"
          >
            {paused ? "Go ready" : "Pause"}
          </button>
          <button
            type="button"
            disabled={busy || !onCall}
            onClick={() => send("external_hangup", { value: "1" })}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-error px-5 text-button text-on-primary disabled:opacity-40"
          >
            <PhoneOff aria-hidden className="size-4" /> Hang up
          </button>
        </div>
      </section>

      {stale && (
        <p className="rounded-lg border border-warning/20 bg-warning/10 p-4 text-caption text-warning">
          Not hearing from the dialer. If this does not clear in a few seconds, open the VICIdial session below and
          check you are logged in.
        </p>
      )}

      <section className="rounded-lg border border-line bg-surface p-6">
        <h2 className="text-title-sm font-bold text-ink">{lead ? "On this call" : "No call"}</h2>
        {lead ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-label uppercase text-muted">Name</dt>
              <dd className="text-body text-ink">{[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-muted">State</dt>
              <dd className="text-body text-ink">{lead.state || "—"}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-muted">Phone ends</dt>
              <dd className="text-body tabular-nums text-ink">{lead.phone_last4 || "—"}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-muted">Called before</dt>
              <dd className="text-body tabular-nums text-ink">{lead.called_count ?? 0}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-caption text-muted">
            When a call connects, the lead appears here. Go ready and the dialer will send you one.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-6">
        <h2 className="text-title-sm font-bold text-ink">Outcome</h2>
        <p className="mt-1 text-caption text-muted">Choosing one hangs up if the call is still live, then moves you on.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {dispositions.map((d) => (
            <button
              key={d.status}
              type="button"
              disabled={busy || stale}
              onClick={() => send("external_status", { value: d.status })}
              className={`inline-flex min-h-11 items-center rounded-full border px-5 text-button disabled:opacity-40 ${
                d.sale
                  ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
                  : d.dnc
                    ? "border-error/30 bg-error/10 text-error hover:bg-error/20"
                    : d.callback
                      ? "border-primary/30 bg-soft-orange text-primary-pressed hover:border-primary"
                      : "border-line bg-surface text-ink hover:border-line-strong"
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-6">
        <h2 className="text-title-sm font-bold text-ink">Dial a number</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dial()}
            placeholder="10 digits"
            inputMode="tel"
            autoComplete="off"
            name="dial-number"
            className="h-11 w-48 rounded-md border border-line-strong bg-surface px-3 text-caption tabular-nums text-ink focus:border-ink focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || stale || onCall}
            onClick={dial}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover disabled:opacity-40"
          >
            <PhoneOutgoing aria-hidden className="size-4" /> Call
          </button>
        </div>
      </section>
    </div>
  );
}
