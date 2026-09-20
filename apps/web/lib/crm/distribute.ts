/**
 * Splitting a batch of leads between agents.
 *
 * "Equally" rarely divides exactly. 101 leads across 3 agents is 34/34/33, and the odd one has
 * to go somewhere — so the remainder is handed out one at a time from the top rather than piled
 * onto the last bucket.
 */

export type Target = {
  /** VICIdial user who will own the leads. */
  owner: string;
  /** The list those leads go into — normally that agent's own list. */
  listId: number;
  /** Campaign the list belongs to, for the dialer's duplicate check. */
  campaignId?: string | null;
  /** Relative share. Equal shares when every target is 1. */
  weight?: number;
};

export type Share<T> = { target: Target; items: T[] };

/** How many each target gets, before anything is moved. */
export function shareCounts(total: number, targets: Target[]): number[] {
  if (targets.length === 0 || total <= 0) return targets.map(() => 0);

  const weights = targets.map((t) => Math.max(t.weight ?? 1, 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return targets.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);

  // Give the remainder to whoever was cut by the most, so the split stays as close to the
  // requested proportions as whole leads allow.
  const order = exact
    .map((value, i) => ({ i, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);

  for (let k = 0; left > 0; k++, left--) counts[order[k % order.length].i]++;

  return counts;
}

/**
 * Deal the items out. Order is preserved within each share, so a run sorted oldest-first stays
 * oldest-first for every agent.
 */
export function distribute<T>(items: T[], targets: Target[]): Share<T>[] {
  const counts = shareCounts(items.length, targets);
  const shares: Share<T>[] = [];
  let at = 0;

  targets.forEach((target, i) => {
    shares.push({ target, items: items.slice(at, at + counts[i]) });
    at += counts[i];
  });

  return shares;
}

/** A short description of the split, for the confirmation line in the UI. */
export function describeSplit(total: number, targets: Target[]): string {
  if (targets.length === 0) return "No one selected";
  if (targets.length === 1) return `All ${total.toLocaleString()} to ${targets[0].owner}`;
  const counts = shareCounts(total, targets);
  return targets.map((t, i) => `${t.owner} ${counts[i].toLocaleString()}`).join(" · ");
}
