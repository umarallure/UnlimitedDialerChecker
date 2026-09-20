import type { SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./config";
import { VicidialApi } from "./vicidial-api";

/**
 * Executes commands queued by the app.
 *
 * The app has no route to VICIdial: it writes a row to `commands`, and this runs it here, on
 * the dialer, over 127.0.0.1. So the API stays closed to the internet and its credentials never
 * leave this machine.
 *
 * A command is claimed by moving it out of `queued` before any work starts, so two agents (or
 * two ticks of the same agent) cannot run it twice.
 */

const MAX_ATTEMPTS = 3;
/** A command claimed but never finished — the agent was restarted mid-flight. */
const STUCK_AFTER_MS = 2 * 60_000;

export type CommandRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  /** Set when this command is one chunk of a larger lead import. */
  import_id: string | null;
};

export type CommandOutcome = { ok: boolean; result: Record<string, unknown> };

/** Run one command. Unknown types fail loudly rather than silently succeeding. */
async function execute(cmd: CommandRow, api: VicidialApi | null): Promise<CommandOutcome> {
  switch (cmd.type) {
    case "api_ping": {
      if (!api) return { ok: false, result: { error: "No VICIdial API credentials configured on the dialer" } };
      const version = await api.call("version");
      if (!version.ok) return { ok: false, result: { error: version.error, step: "version" } };

      // version answers without credentials, so a second call is what actually proves the login.
      const campaigns = await api.call("campaigns_list");
      if (!campaigns.ok) return { ok: false, result: { error: campaigns.error, step: "campaigns_list" } };

      return {
        ok: true,
        result: {
          version: version.message,
          campaigns: campaigns.rows.map((r) => r[0]).filter(Boolean),
        },
      };
    }
    case "add_leads": {
      if (!api) return { ok: false, result: { error: "No VICIdial API credentials configured on the dialer" } };
      return addLeads(cmd, api);
    }
    case "resync":
      // Handled by the sync loops; queuing it just marks the request.
      return { ok: true, result: { note: "Sync loops run on their own schedule" } };
    default:
      return { ok: false, result: { error: `This dialer agent does not implement "${cmd.type}"` } };
  }
}


/** One lead as the app sends it. Everything except the phone number is optional. */
type LeadInput = {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  email?: string;
  altPhone?: string;
  comments?: string;
  vendorLeadCode?: string;
};

type AddLeadsPayload = {
  listId: number;
  owner?: string;
  campaignId?: string;
  dncCheck?: boolean;
  duplicateCheck?: string;
  leads: LeadInput[];
};

/**
 * Loads a batch of leads, one API call each — VICIdial has no bulk insert for add_lead.
 *
 * Every lead is reported individually. A batch that is half duplicates is a normal outcome,
 * not a failure, so duplicates are counted apart from errors and the import screen can show
 * exactly which rows did not land.
 */
async function addLeads(cmd: CommandRow, api: VicidialApi): Promise<CommandOutcome> {
  const p = cmd.payload as unknown as AddLeadsPayload;
  if (!p?.listId || !Array.isArray(p.leads) || p.leads.length === 0) {
    return { ok: false, result: { error: "Nothing to import: the command has no leads or no list" } };
  }

  const rows: Array<{ phone: string; ok: boolean; leadId?: number; duplicate?: boolean; error?: string }> = [];
  let added = 0;
  let duplicates = 0;
  let failed = 0;

  for (const lead of p.leads) {
    const res = await api.call("add_lead", {
      phone_number: lead.phoneNumber,
      phone_code: 1,
      list_id: p.listId,
      owner: p.owner,
      campaign_id: p.campaignId,
      dnc_check: p.dncCheck ? "Y" : "N",
      duplicate_check: p.duplicateCheck ?? "DUPLIST",
      first_name: lead.firstName,
      last_name: lead.lastName,
      address1: lead.address1,
      city: lead.city,
      state: lead.state,
      postal_code: lead.postalCode,
      email: lead.email,
      alt_phone: lead.altPhone,
      comments: lead.comments,
      vendor_lead_code: lead.vendorLeadCode,
    });

    if (res.ok) {
      // "add_lead LEAD HAS BEEN ADDED - 2125550147|101|70|-4|udcapi"
      const leadId = Number(res.message.split("|")[2]);
      rows.push({ phone: lead.phoneNumber, ok: true, leadId: Number.isFinite(leadId) ? leadId : undefined });
      added++;
    } else if (/DUPLICATE/i.test(res.error)) {
      rows.push({ phone: lead.phoneNumber, ok: false, duplicate: true, error: "Already in this list" });
      duplicates++;
    } else if (/DNC/i.test(res.error)) {
      rows.push({ phone: lead.phoneNumber, ok: false, error: "On the do-not-call list" });
      failed++;
    } else {
      rows.push({ phone: lead.phoneNumber, ok: false, error: res.error });
      failed++;
    }
  }

  // Duplicates and DNC hits are expected outcomes, so the command only fails when nothing landed
  // and something genuinely broke.
  return { ok: !(added === 0 && failed > 0), result: { added, duplicates, failed, rows } };
}

/**
 * Claim and run whatever is waiting. Returns how many were handled, so the caller can stay
 * quiet on an idle queue.
 */
export async function processCommands(db: SupabaseClient, cfg: Config, log: (msg: string) => void): Promise<number> {
  // Free anything a previous run claimed and never finished.
  await db
    .from("commands")
    .update({ status: "queued", claimed_by: null })
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - STUCK_AFTER_MS).toISOString());

  const { data: queued, error } = await db
    .from("commands")
    .select("id, type, payload, attempts, import_id")
    .eq("status", "queued")
    .order("created_at")
    .limit(5);
  if (error) throw new Error(`read commands: ${error.message}`);
  if (!queued || queued.length === 0) return 0;

  const api = cfg.api ? new VicidialApi(cfg.api) : null;
  let handled = 0;

  for (const row of queued) {
    // Claiming is a conditional update: if another worker got there first, this changes nothing.
    const { data: claimed } = await db
      .from("commands")
      .update({ status: "running", started_at: new Date().toISOString(), attempts: row.attempts + 1, claimed_by: cfg.dialerName })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const cmd = row as CommandRow;
    let outcome: CommandOutcome;
    try {
      outcome = await execute(cmd, api);
    } catch (err) {
      outcome = { ok: false, result: { error: err instanceof Error ? err.message : String(err) } };
    }

    const attempts = row.attempts + 1;
    const retryable = !outcome.ok && attempts < MAX_ATTEMPTS;

    await db
      .from("commands")
      .update({
        status: outcome.ok ? "done" : retryable ? "queued" : "failed",
        result: outcome.result,
        finished_at: outcome.ok || !retryable ? new Date().toISOString() : null,
        claimed_by: retryable ? null : cfg.dialerName,
      })
      .eq("id", row.id);

    // Roll a finished chunk into its import, so the screen shows one job rather than many.
    if (cmd.import_id && !retryable) {
      const r = outcome.result as { added?: number; duplicates?: number; failed?: number };
      const { error: rpcError } = await db.rpc("record_import_chunk", {
        p_import: cmd.import_id,
        p_added: r.added ?? 0,
        p_duplicates: r.duplicates ?? 0,
        p_failed: r.failed ?? (outcome.ok ? 0 : (cmd.payload as { leads?: unknown[] }).leads?.length ?? 0),
      });
      if (rpcError) log(`import totals not recorded: ${rpcError.message}`);
    }

    handled++;
    log(`${cmd.type} ${outcome.ok ? "done" : retryable ? `failed, retrying (${attempts}/${MAX_ATTEMPTS})` : "failed"}`);
  }

  return handled;
}
