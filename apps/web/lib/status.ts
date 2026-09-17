type Tone = "neutral" | "success" | "warning" | "error" | "accent";

/** Semantic color for each DID lifecycle state. Orange is reserved for actions, so COOLING stays neutral. */
export const LIFECYCLE_TONE: Record<string, Tone> = {
  NEW: "neutral",
  WARMING: "warning",
  ACTIVE: "success",
  COOLING: "neutral",
  RETIRED: "error",
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
