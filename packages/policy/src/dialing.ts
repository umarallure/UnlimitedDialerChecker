/**
 * Predictive dialing: how many lines an agent may run in parallel, and whether the
 * plan fits inside the dialer's and the carrier's capacity.
 *
 * Pure, so the numbers shown in Settings are the same ones any enforcement would use.
 * Terms map to VICIdial campaign columns:
 *   linesPerAgent      -> auto_dial_level
 *   maxLinesPerAgent   -> adaptive_maximum_level
 *   maxDropPct         -> adaptive_dropped_percentage
 *   dialTimeoutSec     -> dial_timeout
 *   dropCallSeconds    -> drop_call_seconds
 *   hopperLevel        -> hopper_level
 *   availableOnlyTally -> available_only_ratio_tally
 */

export const DIAL_METHODS = ["MANUAL", "RATIO", "ADAPT_HARD_LIMIT", "ADAPT_TAPERED", "ADAPT_AVERAGE"] as const;
export type DialMethod = (typeof DIAL_METHODS)[number];

/** Methods that place more than one call per agent. MANUAL dials one number at a time. */
export const PREDICTIVE_METHODS: DialMethod[] = ["RATIO", "ADAPT_HARD_LIMIT", "ADAPT_TAPERED", "ADAPT_AVERAGE"];

export type DialSettings = {
  dialMethod: DialMethod;
  linesPerAgent: number;
  maxLinesPerAgent: number;
  maxDropPct: number;
  dialTimeoutSec: number;
  dropCallSeconds: number;
  hopperLevel: number;
  availableOnlyTally: boolean;
};

export type Capacity = {
  /** Agents expected on the campaign at once. */
  agents: number;
  /** The dialer's own ceiling on concurrent calls (servers.max_vicidial_trunks). */
  serverTrunks: number;
  /** Channels the carrier will carry at once. */
  carrierChannels: number;
  /** Lines held back for inbound and transfers. */
  reservedLines: number;
};

export const DEFAULT_DIAL_SETTINGS: DialSettings = {
  dialMethod: "MANUAL",
  linesPerAgent: 1,
  maxLinesPerAgent: 3,
  maxDropPct: 3,
  dialTimeoutSec: 30,
  dropCallSeconds: 2,
  hopperLevel: 20,
  availableOnlyTally: true,
};

/** The FTC Telemarketing Sales Rule caps abandoned calls at 3% per campaign per day. */
export const TSR_MAX_DROP_PCT = 3;

export type Issue = { level: "error" | "warning" | "info"; field: keyof DialSettings | "capacity"; message: string };

export type Plan = {
  /** Concurrent outbound lines this plan asks for at full staffing. */
  linesNeeded: number;
  /** Lines available for outbound after the inbound reserve. */
  linesAvailable: number;
  /** What runs out first. */
  limitedBy: "server" | "carrier" | "none";
  /** Highest whole-tenth lines per agent that still fits. */
  maxFittingLinesPerAgent: number;
  headroom: number;
};

function floorTenth(n: number): number {
  return Math.floor(n * 10) / 10;
}

export function planCapacity(settings: DialSettings, capacity: Capacity): Plan {
  const ceiling = Math.min(capacity.serverTrunks, capacity.carrierChannels);
  const linesAvailable = Math.max(0, ceiling - capacity.reservedLines);
  const linesNeeded = Math.ceil(capacity.agents * settings.linesPerAgent);
  const limitedBy =
    linesNeeded <= linesAvailable ? "none" : capacity.serverTrunks <= capacity.carrierChannels ? "server" : "carrier";

  return {
    linesNeeded,
    linesAvailable,
    limitedBy,
    maxFittingLinesPerAgent: capacity.agents > 0 ? floorTenth(linesAvailable / capacity.agents) : 0,
    headroom: linesAvailable - linesNeeded,
  };
}

/**
 * Everything wrong or risky about a plan, worst first. Errors are things that would
 * break dialing or break the rules; warnings are things that hurt answer rates or
 * caller-ID reputation.
 */
export function validateDialPlan(s: DialSettings, capacity: Capacity): Issue[] {
  const plan = planCapacity(s, capacity);
  const issues: Issue[] = [];
  const predictive = PREDICTIVE_METHODS.includes(s.dialMethod);

  if (s.maxDropPct > TSR_MAX_DROP_PCT) {
    issues.push({ level: "error", field: "maxDropPct", message: `Abandoned calls are capped at ${TSR_MAX_DROP_PCT}% a day per campaign. ${s.maxDropPct}% would break that.` });
  }

  if (!predictive && s.linesPerAgent > 1) {
    issues.push({ level: "error", field: "dialMethod", message: "Manual dialing places one call at a time. Choose a predictive method to dial several lines per agent." });
  }

  if (predictive && s.linesPerAgent < 1) {
    issues.push({ level: "error", field: "linesPerAgent", message: "A predictive campaign needs at least 1 line per agent." });
  }

  if (plan.linesNeeded > plan.linesAvailable) {
    const where = plan.limitedBy === "server" ? `the dialer's ${capacity.serverTrunks} trunks` : `the carrier's ${capacity.carrierChannels} channels`;
    issues.push({
      level: "error",
      field: "capacity",
      message: `${capacity.agents} agents at ${s.linesPerAgent} lines needs ${plan.linesNeeded} calls at once, but only ${plan.linesAvailable} are free after the inbound reserve — ${where} run out first. The most that fits is ${plan.maxFittingLinesPerAgent} lines per agent.`,
    });
  }

  if (s.linesPerAgent > s.maxLinesPerAgent) {
    issues.push({ level: "error", field: "maxLinesPerAgent", message: `The ceiling (${s.maxLinesPerAgent}) is below the lines per agent (${s.linesPerAgent}).` });
  }

  if (s.dropCallSeconds > 2) {
    issues.push({
      level: "warning",
      field: "dropCallSeconds",
      message: `A call counts as abandoned if nobody reaches it within 2 seconds of the customer's greeting. Waiting ${s.dropCallSeconds} seconds makes the measured drop rate look lower than the rule counts it.`,
    });
  }

  if (s.linesPerAgent > 2) {
    issues.push({
      level: "warning",
      field: "linesPerAgent",
      message: `${s.linesPerAgent} lines per agent is aggressive for a small floor: more calls are answered with nobody free, which raises drops and gets numbers labeled.`,
    });
  }

  if (s.dialTimeoutSec < 25) {
    issues.push({ level: "warning", field: "dialTimeoutSec", message: `${s.dialTimeoutSec} seconds is about 4 rings. Hanging up early looks like a robocall to carrier analytics.` });
  }
  if (s.dialTimeoutSec > 60) {
    issues.push({ level: "warning", field: "dialTimeoutSec", message: `${s.dialTimeoutSec} seconds holds a line open long after most people would answer, wasting capacity.` });
  }

  const suggestedHopper = Math.max(10, Math.ceil(capacity.agents * s.linesPerAgent * 2));
  if (predictive && s.hopperLevel < suggestedHopper) {
    issues.push({
      level: "warning",
      field: "hopperLevel",
      message: `The hopper holds ${s.hopperLevel} leads. At this pace the dialer can run it dry; about ${suggestedHopper} gives it room.`,
    });
  }

  if (predictive && !s.availableOnlyTally) {
    issues.push({ level: "info", field: "availableOnlyTally", message: "Counting only agents who are actually available paces the dialer more tightly and drops fewer calls." });
  }

  if (predictive && plan.headroom > 0 && plan.headroom < capacity.agents) {
    issues.push({ level: "info", field: "capacity", message: `Only ${plan.headroom} spare line${plan.headroom === 1 ? "" : "s"} at full staffing. Adding an agent would need the ceiling raised.` });
  }

  const order = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/** Drift between what an operator asked for and what VICIdial actually holds. */
export function settingsDrift(desired: DialSettings, live: Partial<DialSettings> | null): Array<{ field: keyof DialSettings; desired: unknown; live: unknown }> {
  if (!live) return [];
  const fields = Object.keys(desired) as Array<keyof DialSettings>;
  return fields
    .filter((f) => live[f] !== undefined && live[f] !== desired[f])
    .map((f) => ({ field: f, desired: desired[f], live: live[f] }));
}
