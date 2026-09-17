export const NUMBER_ACTIONS = [
  "set_fcr",
  "set_callback",
  "set_attestation",
  "set_cnam",
  "set_notes",
  "set_cap_override",
  "hold",
  "release",
  "force_cool",
  "restart_warmup",
  "retire",
] as const;

export type NumberAction = (typeof NUMBER_ACTIONS)[number];
export type ActionPayload = { value?: boolean | string | number | null; reason?: string };

export type SetupFields = {
  fcr_registered_at: string | null;
  inbound_route_ok: boolean;
  attestation: string | null;
  cnam: string | null;
};

/** Setup steps shown on every number. `required` steps gate the move from Aging to Warming. */
export function setupChecklist(d: SetupFields) {
  return [
    { key: "fcr", label: "Registered on Free Caller Registry", done: Boolean(d.fcr_registered_at), required: true },
    { key: "callback", label: "Callbacks reach the IVR", done: d.inbound_route_ok, required: true },
    { key: "attestation", label: "STIR/SHAKEN attestation is A", done: d.attestation === "A", required: true },
    { key: "cnam", label: "Caller name (CNAM) set", done: Boolean(d.cnam), required: false },
  ] as const;
}

export function setupProgress(d: SetupFields) {
  const items = setupChecklist(d).filter((i) => i.required);
  return { done: items.filter((i) => i.done).length, total: items.length };
}

export async function runNumberAction(ids: string[], action: NumberAction, payload: ActionPayload = {}) {
  const res = await fetch("/api/numbers/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids, action, payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Action failed (HTTP ${res.status}).`);
  return body as { action: NumberAction; changed: number; requested: number };
}

/** One-line guidance for the most useful thing to do with a number next. */
export function nextStep(d: SetupFields & { lifecycle: string; manual_hold: boolean }) {
  if (d.manual_hold) return "Held manually. Release it when the issue is resolved.";
  if (d.lifecycle === "NEW") {
    if (!d.fcr_registered_at) return "Register on Free Caller Registry before first use.";
    if (!d.inbound_route_ok) return "Verify callbacks reach the IVR.";
    if (d.attestation !== "A") return "Confirm A-level attestation with Teleinx.";
    return "Setup complete. Waiting for 7 days of aging and a clean reputation scan.";
  }
  if (d.attestation && d.attestation !== "A") return "Not A-attested. Replace with a Teleinx DID.";
  if (d.lifecycle === "COOLING") return "Resting. Scan reputation before it returns to warm-up.";
  if (d.lifecycle === "RETIRED") return "Keep routing callbacks for 90 days, then release.";
  return "Healthy. Keep usage under the daily cap.";
}
