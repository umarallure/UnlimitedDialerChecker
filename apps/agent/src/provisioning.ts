import type { Pool, RowDataPacket } from "mysql2/promise";
import type { VicidialApi } from "./vicidial-api";

/**
 * Creating an agent: a VICIdial user, their own campaign, their own list, and a user group that
 * admits them to that campaign and nothing else.
 *
 * The campaign is the awkward part. VICIdial's API has add_user, add_list and add_did, but no
 * add_campaign, so a campaign has to be copied from a template. `vicidial_campaigns` has 370
 * columns; composing a row would inherit whatever each column default happens to be, and a
 * temporary table cannot hold the row at all (InnoDB's 8126-byte limit). So the copy is one
 * INSERT ... SELECT with an explicit column list, overriding only what must differ — every other
 * setting, including the pacing and compliance ones, comes from the template.
 */

export const TEMPLATE_CAMPAIGN = "TEMPLATE";

export type NewAgent = {
  user: string;
  password: string;
  fullName: string;
  /** Campaign id, 8 characters at most in VICIdial. */
  campaignId: string;
  campaignName: string;
  listId: number;
  listName: string;
  /** Caller ID for the campaign, digits only. Optional: it can be set later from the pool. */
  campaignCid?: string;
};

export type ProvisionStep = { step: string; ok: boolean; detail?: string };

/** VICIdial's own limits, checked before anything is created so a run cannot half-finish. */
export function validateNewAgent(a: NewAgent): string | null {
  if (!/^[A-Za-z0-9_]{2,20}$/.test(a.user)) return "A username may use letters, numbers and underscores, 2 to 20 characters.";
  if (a.password.length < 8) return "The password must be at least 8 characters.";
  if (!/^[A-Z0-9_]{2,8}$/.test(a.campaignId)) return "A campaign id may use capitals, numbers and underscores, 2 to 8 characters.";
  if (!Number.isInteger(a.listId) || a.listId < 100 || a.listId > 999999) return "A list id must be a whole number between 100 and 999999.";
  if (a.campaignCid && !/^[2-9]\d{9}$/.test(a.campaignCid)) return "The caller ID must be a 10-digit US number.";
  return null;
}

async function exists(pool: Pool, sql: string, value: string | number): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, [value]);
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Copy the template into a new campaign.
 * Returns the number of columns carried over, which is the useful proof that nothing was lost.
 */
export async function copyTemplateCampaign(
  pool: Pool,
  campaignId: string,
  campaignName: string,
  overrides: Record<string, string> = {},
): Promise<number> {
  const [cols] = await pool.query<RowDataPacket[]>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'vicidial_campaigns'
      ORDER BY ordinal_position`,
  );

  const all: Record<string, string> = { campaign_id: campaignId, campaign_name: campaignName, active: "Y", ...overrides };
  const names: string[] = [];
  const exprs: string[] = [];
  const values: string[] = [];

  for (const row of cols) {
    const name = String(row.column_name ?? row.COLUMN_NAME);
    names.push(`\`${name}\``);
    if (name in all) {
      exprs.push("?");
      values.push(all[name]);
    } else {
      exprs.push(`\`${name}\``);
    }
  }

  await pool.execute(
    `INSERT INTO vicidial_campaigns (${names.join(",")}) SELECT ${exprs.join(",")} FROM vicidial_campaigns WHERE campaign_id = ?`,
    [...values, TEMPLATE_CAMPAIGN],
  );

  return names.length;
}

/**
 * Create everything one agent needs. Each step is reported, so a partial run says exactly how
 * far it got rather than failing as a whole and leaving an operator to guess.
 */
export async function provisionAgent(pool: Pool, api: VicidialApi, a: NewAgent): Promise<{ ok: boolean; steps: ProvisionStep[] }> {
  const steps: ProvisionStep[] = [];
  const record = (step: string, ok: boolean, detail?: string) => {
    steps.push({ step, ok, detail });
    return ok;
  };

  // Nothing is created until every name is known to be free: a half-made agent is worse than none.
  if (await exists(pool, "SELECT COUNT(*) AS n FROM vicidial_users WHERE user = ?", a.user)) {
    return { ok: false, steps: [{ step: "check", ok: false, detail: `The user "${a.user}" already exists` }] };
  }
  if (await exists(pool, "SELECT COUNT(*) AS n FROM vicidial_campaigns WHERE campaign_id = ?", a.campaignId)) {
    return { ok: false, steps: [{ step: "check", ok: false, detail: `The campaign "${a.campaignId}" already exists` }] };
  }
  if (await exists(pool, "SELECT COUNT(*) AS n FROM vicidial_lists WHERE list_id = ?", a.listId)) {
    return { ok: false, steps: [{ step: "check", ok: false, detail: `List ${a.listId} already exists` }] };
  }
  if (!(await exists(pool, "SELECT COUNT(*) AS n FROM vicidial_campaigns WHERE campaign_id = ?", TEMPLATE_CAMPAIGN))) {
    return { ok: false, steps: [{ step: "check", ok: false, detail: `No "${TEMPLATE_CAMPAIGN}" campaign to copy from` }] };
  }
  record("check", true, "names are free");

  const group = `UG_${a.user}`.slice(0, 20);
  try {
    await pool.execute("INSERT INTO vicidial_user_groups (user_group, group_name, allowed_campaigns) VALUES (?, ?, ?)", [
      group,
      `${a.fullName || a.user} only`,
      ` ${a.campaignId} `, // VICIdial matches this space-delimited, so the spaces matter
    ]);
    record("user group", true, group);
  } catch (err) {
    return { ok: false, steps: [...steps, { step: "user group", ok: false, detail: err instanceof Error ? err.message : String(err) }] };
  }

  try {
    const columns = await copyTemplateCampaign(pool, a.campaignId, a.campaignName, a.campaignCid ? { campaign_cid: a.campaignCid } : {});
    record("campaign", true, `${a.campaignId} copied from ${TEMPLATE_CAMPAIGN} (${columns} settings)`);
  } catch (err) {
    return { ok: false, steps: [...steps, { step: "campaign", ok: false, detail: err instanceof Error ? err.message : String(err) }] };
  }

  const list = await api.call("add_list", {
    list_id: a.listId,
    list_name: a.listName,
    campaign_id: a.campaignId,
    active: "Y",
  });
  if (!record("list", list.ok, list.ok ? `${a.listId} ${a.listName}` : list.error)) {
    return { ok: false, steps };
  }

  const user = await api.call("add_user", {
    agent_user: a.user,
    agent_pass: a.password,
    agent_full_name: a.fullName,
    agent_user_level: 1,
    agent_user_group: group,
  });
  if (!record("user", user.ok, user.ok ? a.user : user.error)) {
    return { ok: false, steps };
  }

  return { ok: true, steps };
}
