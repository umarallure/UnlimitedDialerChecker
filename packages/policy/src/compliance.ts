/**
 * Abandoned-call maths.
 *
 * The Telemarketing Sales Rule caps abandoned calls at 3% of calls answered by a person,
 * per campaign per day. The denominator is the point people get wrong: it is calls a human
 * picked up, not calls placed. Ringing out unanswered does not make the rate look better.
 */

export const TSR_ABANDON_CAP_PCT = 3;

/** VICIdial statuses that mean a person answered and then got no agent. */
export const DROP_STATUSES = ["DROP", "PDROP", "AB"];

export type CampaignDay = {
  /** Calls a person answered and an agent took. */
  connected: number;
  /** Calls a person answered with no agent free. */
  drops: number;
};

/**
 * Abandoned calls as a percentage of calls a person answered.
 * Returns null when nobody answered at all — a rate of "0%" would imply a clean day
 * when in truth there is nothing to judge.
 */
export function abandonRate(day: CampaignDay): number | null {
  const answered = day.connected + day.drops;
  if (answered === 0) return null;
  return (day.drops / answered) * 100;
}

export type ComplianceLevel = "ok" | "at_risk" | "over" | "unknown";

/**
 * How a campaign's day is going against the cap. "at_risk" starts at two thirds of the cap,
 * early enough to pace down before the day's average is spoiled — the rate is measured over
 * the whole day, so a bad hour cannot be undone, only diluted.
 */
export function complianceLevel(rate: number | null, cap = TSR_ABANDON_CAP_PCT): ComplianceLevel {
  if (rate === null) return "unknown";
  if (rate > cap) return "over";
  if (rate >= cap * (2 / 3)) return "at_risk";
  return "ok";
}

/**
 * How many more calls a campaign may abandon today and still finish under the cap,
 * assuming every further call is answered by a person and taken by an agent.
 * Negative means the day is already over the cap and cannot be brought back by dilution alone.
 */
export function abandonsRemaining(day: CampaignDay, cap = TSR_ABANDON_CAP_PCT): number {
  const answered = day.connected + day.drops;
  if (answered === 0) return 0;
  // drops <= cap% of answered  =>  allowed = floor(cap * answered / 100)
  return Math.floor((cap * answered) / 100) - day.drops;
}

/**
 * Calls that must be connected without a single further abandon to bring a day back
 * under the cap. Null when already compliant or when nothing has been answered.
 */
export function callsToRecover(day: CampaignDay, cap = TSR_ABANDON_CAP_PCT): number | null {
  const rate = abandonRate(day);
  if (rate === null || rate <= cap) return null;
  // (drops / (answered + n)) * 100 <= cap  =>  n >= drops*100/cap - answered
  const answered = day.connected + day.drops;
  return Math.ceil((day.drops * 100) / cap - answered);
}
