import type { ActionPayload, NumberAction } from "./number-actions";

type Result = { changed: number; requested: number };

/** Toast title and description for a number action, for one number (label) or many. */
export function describeAction(action: NumberAction, payload: ActionPayload, result: Result, label?: string): { title: string; description?: string; noop: boolean } {
  const many = result.requested > 1;
  const who = many ? `${result.changed} of ${result.requested} numbers` : (label ?? "Number");
  const noop = result.changed === 0;
  if (noop) {
    return { title: many ? "No numbers changed" : "No change needed", description: many ? "They were already in that state." : `${label ?? "This number"} was already in that state.`, noop };
  }

  const reason = payload.reason ? `Reason: ${payload.reason}` : undefined;
  const on = payload.value === true;

  switch (action) {
    case "set_fcr":
      return { title: on ? `Marked registered: ${who}` : `Registration cleared: ${who}`, description: on ? "Free Caller Registry step complete." : "Free Caller Registry step reopened.", noop };
    case "set_callback":
      return { title: on ? `Callback verified: ${who}` : `Callback marked not working: ${who}`, description: on ? "Callbacks reach the IVR." : "Fix the inbound route before this number dials.", noop };
    case "set_attestation":
      return {
        title: payload.value ? `Attestation ${payload.value}: ${who}` : `Attestation cleared: ${who}`,
        description: payload.value === "A" ? "Full attestation confirmed." : payload.value ? "Only A-attested numbers should dial." : undefined,
        noop,
      };
    case "set_cnam":
      return { title: `Caller name saved: ${who}`, description: payload.value ? String(payload.value) : "Caller name cleared.", noop };
    case "set_notes":
      return { title: `Notes saved: ${who}`, noop };
    case "set_cap_override":
      return {
        title: payload.value === null || payload.value === undefined ? `Cap override removed: ${who}` : `Daily cap set to ${payload.value}: ${who}`,
        description: payload.value === null || payload.value === undefined ? "Back to the lifecycle cap." : "Overrides the lifecycle cap.",
        noop,
      };
    case "hold":
      return { title: `Held: ${who}`, description: reason ?? "Won’t dial until released.", noop };
    case "release":
      return { title: `Released: ${who}`, description: "Available to dial again within its caps.", noop };
    case "force_cool":
      return { title: `Cooling off: ${who}`, description: reason ?? "Outbound calls stop for 7–14 days; callbacks keep working.", noop };
    case "restart_warmup":
      return { title: `Warm-up started: ${who}`, description: reason ?? "Starts at 20 calls a day.", noop };
    case "retire":
      return { title: `Retired: ${who}`, description: reason ?? "Keep callbacks routed for 90 days before releasing it.", noop };
  }
}
