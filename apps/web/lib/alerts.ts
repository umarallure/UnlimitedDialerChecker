export const ALERT_KIND_LABEL: Record<string, string> = {
  answer_rate_low: "Low answer rate",
  short_calls_high: "Too many short calls",
  short_calls_rising: "Short calls rising",
  drop_rate_high: "High drop rate",
  sip_608_spike: "Carrier rejections (608)",
  answer_rate_drop: "Answer rate falling",
  spam_label: "Spam label",
  sync_stale: "Dialer sync stopped",
  pool_drop_rate: "Pool drop rate",
  state_uncovered: "State without numbers",
};

export function alertKindLabel(kind: string) {
  return ALERT_KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

export function severityTone(severity: string): "error" | "warning" | "neutral" {
  return severity === "critical" ? "error" : severity === "warning" ? "warning" : "neutral";
}
