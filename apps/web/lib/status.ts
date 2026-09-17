type Tone = "neutral" | "success" | "warning" | "error" | "accent";

/** Semantic color for each DID lifecycle state. Orange is reserved for actions, so COOLING stays neutral. */
export const LIFECYCLE_TONE: Record<string, Tone> = {
  NEW: "neutral",
  WARMING: "warning",
  ACTIVE: "success",
  COOLING: "neutral",
  RETIRED: "error",
};

export const LIFECYCLE_LABEL: Record<string, string> = {
  NEW: "Aging",
  WARMING: "Warming",
  ACTIVE: "Active",
  COOLING: "Cooling",
  RETIRED: "Retired",
};

export const LIFECYCLE_NOTE: Record<string, string> = {
  NEW: "Aging 7 days before first call",
  WARMING: "Ramping 20 → 40 → 60 calls a day",
  ACTIVE: "In rotation, 60 calls a day cap",
  COOLING: "Resting 7–14 days, inbound stays live",
  RETIRED: "Out of outbound use",
};

/** Semantic color for VICIdial agent status. */
export function agentTone(status: string): Tone {
  switch (status) {
    case "READY":
      return "success";
    case "INCALL":
    case "QUEUE":
      return "accent";
    case "PAUSED":
      return "warning";
    default:
      return "neutral";
  }
}

const AGENT_LABEL: Record<string, string> = { READY: "Ready", INCALL: "In call", QUEUE: "Queued", PAUSED: "Paused", CLOSER: "Closer" };
export function agentLabel(status: string): string {
  return AGENT_LABEL[status] ?? status;
}

/** Semantic color for a VICIdial call status. */
export function callTone(status: string): Tone {
  if (["SALE", "CALLBK", "CBHOLD", "NI", "DEC", "A"].includes(status)) return "success";
  if (["DROP", "PDROP", "DNC", "DNCL", "DNCC", "ADC", "DC"].includes(status)) return "error";
  if (["NA", "B", "AA", "AM", "AL", "N"].includes(status)) return "neutral";
  if (status === "INCALL") return "accent";
  return "warning";
}
