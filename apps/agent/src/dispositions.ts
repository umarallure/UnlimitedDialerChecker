import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * The outcomes an agent can pick at the end of a call.
 *
 * VICIdial has two layers: system statuses shared by every campaign, and campaign statuses that
 * belong to one campaign. An outcome a business cares about — "wrong number", "does not
 * qualify" — is a campaign status; the API has no function for them, so they are written to
 * `vicidial_campaign_statuses` directly, under a grant covering that one table.
 *
 * The flags matter more than they look. `sale`, `dnc`, `not_interested` and `scheduled_callback`
 * are what VICIdial's own reports and the DNC machinery read: a "Do not call" outcome that does
 * not set `dnc` records the agent's intent and then dials the person again.
 */

export type Disposition = {
  status: string;
  name: string;
  /** Somebody picked up. Drives the answer-rate figures the rotation engine judges numbers on. */
  humanAnswered?: boolean;
  sale?: boolean;
  dnc?: boolean;
  notInterested?: boolean;
  /** Not worth calling again, for list hygiene rather than the law. */
  unworkable?: boolean;
  scheduledCallback?: boolean;
};

/** VICIdial's own limits on a status code. */
export function validateDisposition(d: Disposition): string | null {
  if (!/^[A-Z0-9_]{2,6}$/.test(d.status)) return `"${d.status}" must be 2 to 6 capitals, numbers or underscores.`;
  if (!d.name.trim() || d.name.length > 30) return `"${d.status}" needs a name of 30 characters or fewer.`;
  return null;
}

const yn = (v: boolean | undefined) => (v ? "Y" : "N");

/**
 * Make a campaign's dispositions match `wanted`: add what is missing, update what changed,
 * remove what is no longer wanted.
 *
 * A status is only removed when no lead is sitting on it. Removing one that leads still carry
 * would leave those leads with an outcome nothing can explain, and no way to filter for them.
 */
export async function applyDispositions(
  pool: Pool,
  campaignId: string,
  wanted: Disposition[],
): Promise<{ added: number; updated: number; removed: number; kept: string[] }> {
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT status, status_name FROM vicidial_campaign_statuses WHERE campaign_id = ?",
    [campaignId],
  );
  const have = new Map(existing.map((r) => [String(r.status), String(r.status_name ?? "")]));
  const want = new Map(wanted.map((d) => [d.status, d]));

  let added = 0;
  let updated = 0;
  let removed = 0;
  const kept: string[] = [];

  for (const d of wanted) {
    const values = [
      d.name.trim(),
      "Y",
      yn(d.humanAnswered ?? true),
      yn(d.sale),
      yn(d.dnc),
      yn(d.notInterested),
      yn(d.unworkable),
      yn(d.scheduledCallback),
    ];

    if (have.has(d.status)) {
      await pool.execute(
        `UPDATE vicidial_campaign_statuses
            SET status_name = ?, selectable = ?, human_answered = ?, sale = ?, dnc = ?,
                not_interested = ?, unworkable = ?, scheduled_callback = ?
          WHERE campaign_id = ? AND status = ?`,
        [...values, campaignId, d.status],
      );
      updated++;
    } else {
      await pool.execute(
        `INSERT INTO vicidial_campaign_statuses
           (campaign_id, status, status_name, selectable, human_answered, sale, dnc,
            not_interested, unworkable, scheduled_callback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [campaignId, d.status, ...values],
      );
      added++;
    }
  }

  for (const status of have.keys()) {
    if (want.has(status)) continue;

    const [inUse] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM vicidial_list v
         JOIN vicidial_lists l ON l.list_id = v.list_id
        WHERE l.campaign_id = ? AND v.status = ?`,
      [campaignId, status],
    );
    if (Number(inUse[0]?.n ?? 0) > 0) {
      kept.push(status);
      continue;
    }

    await pool.execute("DELETE FROM vicidial_campaign_statuses WHERE campaign_id = ? AND status = ?", [campaignId, status]);
    removed++;
  }

  return { added, updated, removed, kept };
}

/** Copy one campaign's dispositions onto another, used when a new agent's campaign is created. */
export async function copyDispositions(pool: Pool, from: string, to: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT status, status_name, selectable, human_answered, sale, dnc, not_interested, unworkable, scheduled_callback FROM vicidial_campaign_statuses WHERE campaign_id = ?",
    [from],
  );

  for (const r of rows) {
    await pool.execute(
      `INSERT IGNORE INTO vicidial_campaign_statuses
         (campaign_id, status, status_name, selectable, human_answered, sale, dnc, not_interested, unworkable, scheduled_callback)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [to, r.status, r.status_name, r.selectable, r.human_answered, r.sale, r.dnc, r.not_interested, r.unworkable, r.scheduled_callback],
    );
  }

  return rows.length;
}
