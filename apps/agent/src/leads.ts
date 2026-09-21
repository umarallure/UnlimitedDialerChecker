import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Mirrors the leads sitting in each campaign's lists.
 *
 * Only the last four digits of a phone number cross over. The app needs to recognise a lead and
 * act on it by id; it does not need a second copy of the calling list.
 *
 * Leads belonging to no campaign are ignored — they cannot be dialled, so there is nothing to
 * manage about them here.
 */

const MAX_LEADS = 20_000;
const BATCH = 500;

export type LeadRow = {
  lead_id: number;
  list_id: number;
  campaign_id: string | null;
  owner: string | null;
  status: string | null;
  first_name: string | null;
  last_name: string | null;
  state: string | null;
  phone_last4: string | null;
  called_count: number;
  last_call_at: string | null;
  entry_date: string | null;
  modify_date: string | null;
};

export async function fetchLeads(pool: Pool): Promise<LeadRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT v.lead_id, v.list_id, l.campaign_id, v.owner, v.status,
            v.first_name, v.last_name, v.state,
            RIGHT(v.phone_number, 4) AS phone_last4,
            v.called_count, v.last_local_call_time, v.entry_date, v.modify_date
       FROM vicidial_list v
       JOIN vicidial_lists l ON l.list_id = v.list_id
      WHERE l.campaign_id IS NOT NULL AND l.campaign_id <> ''
      ORDER BY v.lead_id
      LIMIT ?`,
    [MAX_LEADS],
  );

  const iso = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);

  return rows.map((r) => ({
    lead_id: Number(r.lead_id),
    list_id: Number(r.list_id),
    campaign_id: r.campaign_id || null,
    owner: r.owner || null,
    status: r.status || null,
    first_name: r.first_name || null,
    last_name: r.last_name || null,
    state: r.state || null,
    phone_last4: r.phone_last4 ? String(r.phone_last4) : null,
    called_count: Number(r.called_count ?? 0),
    last_call_at: iso(r.last_local_call_time),
    entry_date: iso(r.entry_date),
    modify_date: iso(r.modify_date),
  }));
}

export async function syncLeads(db: SupabaseClient, pool: Pool): Promise<{ leads: number; removed: number; capped: boolean }> {
  const leads = await fetchLeads(pool);
  const now = new Date().toISOString();

  for (let i = 0; i < leads.length; i += BATCH) {
    const { error } = await db
      .from("vici_leads")
      .upsert(leads.slice(i, i + BATCH).map((l) => ({ ...l, synced_at: now })), { onConflict: "lead_id" });
    if (error) throw new Error(`sync leads: ${error.message}`);
  }

  // A lead deleted or moved out of a campaign's lists should disappear from here too. Guarded
  // on a non-empty read so a failed query cannot empty the mirror.
  let removed = 0;
  if (leads.length > 0) {
    const { data, error } = await db
      .from("vici_leads")
      .delete()
      .lt("synced_at", now)
      .select("lead_id");
    if (error) throw new Error(`prune leads: ${error.message}`);
    removed = data?.length ?? 0;
  }

  return { leads: leads.length, removed, capped: leads.length === MAX_LEADS };
}
