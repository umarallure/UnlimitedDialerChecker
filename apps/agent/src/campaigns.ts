import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Read-only snapshot of how each campaign is actually dialing, so the app can show the
 * difference between what an operator asked for and what VICIdial holds.
 *
 * `max_vicidial_trunks` is the dialer's own ceiling on concurrent calls and is usually
 * far below what the carrier allows, so it decides how many lines an agent can run.
 */

export type LiveCampaign = {
  campaignId: string;
  active: boolean;
  dialMethod: string;
  linesPerAgent: number;
  maxLinesPerAgent: number;
  maxDropPct: number;
  dialTimeoutSec: number;
  dropCallSeconds: number;
  hopperLevel: number;
  availableOnlyTally: boolean;
  agentsLoggedIn: number;
  leadsInHopper: number;
  serverTrunks: number | null;
};

export async function fetchCampaigns(pool: Pool): Promise<LiveCampaign[]> {
  const [trunkRows] = await pool.query<RowDataPacket[]>(
    "SELECT SUM(max_vicidial_trunks) AS trunks FROM servers WHERE active_asterisk_server = 'Y'",
  );
  const trunks = trunkRows[0]?.trunks === null || trunkRows[0]?.trunks === undefined ? null : Number(trunkRows[0].trunks);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.campaign_id, c.active, c.dial_method, c.auto_dial_level, c.adaptive_maximum_level,
            c.adaptive_dropped_percentage, c.dial_timeout, c.drop_call_seconds, c.hopper_level,
            c.available_only_ratio_tally,
            (SELECT COUNT(*) FROM vicidial_live_agents la WHERE la.campaign_id = c.campaign_id) AS agents_logged_in,
            (SELECT COUNT(*) FROM vicidial_hopper h WHERE h.campaign_id = c.campaign_id) AS leads_in_hopper
       FROM vicidial_campaigns c`,
  );

  return rows.map((r) => ({
    campaignId: String(r.campaign_id),
    active: r.active === "Y",
    dialMethod: String(r.dial_method),
    linesPerAgent: Number(r.auto_dial_level),
    maxLinesPerAgent: Number(r.adaptive_maximum_level),
    maxDropPct: Number(r.adaptive_dropped_percentage),
    dialTimeoutSec: Number(r.dial_timeout),
    dropCallSeconds: Number(r.drop_call_seconds),
    hopperLevel: Number(r.hopper_level),
    availableOnlyTally: r.available_only_ratio_tally === "Y",
    agentsLoggedIn: Number(r.agents_logged_in ?? 0),
    leadsInHopper: Number(r.leads_in_hopper ?? 0),
    serverTrunks: trunks,
  }));
}

export async function syncCampaigns(db: SupabaseClient, pool: Pool): Promise<number> {
  const campaigns = await fetchCampaigns(pool);
  if (campaigns.length === 0) return 0;

  const { error } = await db.from("campaigns_live").upsert(
    campaigns.map((c) => ({
      campaign_id: c.campaignId,
      active: c.active,
      dial_method: c.dialMethod,
      lines_per_agent: c.linesPerAgent,
      max_lines_per_agent: c.maxLinesPerAgent,
      max_drop_pct: c.maxDropPct,
      dial_timeout_sec: c.dialTimeoutSec,
      drop_call_seconds: c.dropCallSeconds,
      hopper_level: c.hopperLevel,
      available_only_tally: c.availableOnlyTally,
      agents_logged_in: c.agentsLoggedIn,
      leads_in_hopper: c.leadsInHopper,
      server_trunks: c.serverTrunks,
      synced_at: new Date().toISOString(),
    })),
    { onConflict: "campaign_id" },
  );
  if (error) throw new Error(`sync campaigns: ${error.message}`);
  return campaigns.length;
}
