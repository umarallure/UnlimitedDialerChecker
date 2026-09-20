import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "mysql2/promise";
import type { Config } from "./config";
import { type NewAgent, provisionAgent, validateNewAgent } from "./provisioning";
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

export type CommandOutcome = {
  ok: boolean;
  result: Record<string, unknown>;
  /**
   * False when trying again cannot help: a plan that breaks a rule is refused the same way
   * every time, so retrying it only fills the log and delays the real answer.
   */
  retryable?: boolean;
};

/** Run one command. Unknown types fail loudly rather than silently succeeding. */
async function execute(cmd: CommandRow, api: VicidialApi | null, pool: Pool): Promise<CommandOutcome> {
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
    case "update_campaign": {
      if (!api) return { ok: false, result: { error: "No VICIdial API credentials configured on the dialer" } };
      return updateCampaign(cmd, api, pool);
    }
    case "create_agent": {
      if (!api) return { ok: false, result: { error: "No VICIdial API credentials configured on the dialer" } };
      const a = cmd.payload as unknown as NewAgent;
      const problem = validateNewAgent(a);
      if (problem) return { ok: false, retryable: false, result: { error: problem } };

      const out = await provisionAgent(pool, api, a);
      // A partial run must not be retried: the steps that succeeded would then collide with
      // themselves. The result lists exactly how far it got.
      return { ok: out.ok, retryable: false, result: { user: a.user, campaignId: a.campaignId, steps: out.steps } };
    }
    case "update_leads": {
      if (!api) return { ok: false, result: { error: "No VICIdial API credentials configured on the dialer" } };
      return updateLeads(cmd, api);
    }
    case "resync":
      // Handled by the sync loops; queuing it just marks the request.
      return { ok: true, result: { note: "Sync loops run on their own schedule" } };
    default:
      return { ok: false, retryable: false, result: { error: `This dialer agent does not implement "${cmd.type}"` } };
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
    return { ok: false, retryable: false, result: { error: "Nothing to import: the command has no leads or no list" } };
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

type UpdateLeadsPayload = {
  leadIds: number[];
  /** Any of these that is present is changed; the rest are left alone. */
  set: { status?: string; owner?: string | null; listId?: number };
};

/**
 * Moves, reassigns or re-queues leads.
 *
 * VICIdial has no delete_lead, and that is no bad thing: a deleted lead takes its call history
 * with it. Taking leads out of a campaign means moving them to another list or giving them a
 * status the campaign does not dial, both of which this does, and both of which are reversible.
 */
async function updateLeads(cmd: CommandRow, api: VicidialApi): Promise<CommandOutcome> {
  const p = cmd.payload as unknown as UpdateLeadsPayload;
  if (!Array.isArray(p?.leadIds) || p.leadIds.length === 0) {
    return { ok: false, retryable: false, result: { error: "No leads were named" } };
  }
  if (!p.set || (p.set.status === undefined && p.set.owner === undefined && p.set.listId === undefined)) {
    return { ok: false, retryable: false, result: { error: "Nothing to change" } };
  }

  let changed = 0;
  const failures: Array<{ leadId: number; error: string }> = [];

  for (const leadId of p.leadIds) {
    const res = await api.call("update_lead", {
      lead_id: leadId,
      search_method: "LEAD_ID",
      status: p.set.status,
      // An empty owner clears it, which is how a lead goes back to the whole campaign.
      owner: p.set.owner === null ? "" : p.set.owner,
      list_id_field: p.set.listId,
    });

    if (res.ok) changed++;
    else failures.push({ leadId, error: res.error });
  }

  return {
    ok: failures.length === 0,
    // Every lead was attempted, so a retry would repeat the ones that worked.
    retryable: false,
    result: { changed, failed: failures.length, failures: failures.slice(0, 20), set: p.set },
  };
}

type UpdateCampaignPayload = {
  campaignId: string;
  // Settings update_campaign accepts.
  dialMethod?: string;
  linesPerAgent?: number;
  maxLinesPerAgent?: number;
  hopperLevel?: number;
  dialTimeoutSec?: number;
  campaignCid?: string;
  active?: boolean;
  // Settings the API has no parameter for, written straight to the column instead.
  maxDropPct?: number;
  dropCallSeconds?: number;
  availableOnlyTally?: boolean;
  recording?: string;
  /** agent_dial_owner_only is an enum, not a switch: USER restricts an agent to leads they own,
   *  USER_BLANK also lets them dial unowned ones, NONE lifts the restriction. */
  ownerOnly?: "NONE" | "USER" | "USER_BLANK" | "TERRITORY" | "USER_GROUP";
};

const OWNER_ONLY_VALUES = ["NONE", "USER", "USER_BLANK", "TERRITORY", "USER_GROUP"];
const RECORDING_VALUES = ["NEVER", "ONDEMAND", "ALLCALLS", "ALLFORCE"];

/** The only columns this agent may write. Matches the column-level grant on the database, so a
 *  mistake here fails on the grant rather than changing something it should not. */
const DIRECT_COLUMNS: Record<string, string> = {
  maxDropPct: "adaptive_dropped_percentage",
  dropCallSeconds: "drop_call_seconds",
  availableOnlyTally: "available_only_ratio_tally",
  recording: "campaign_recording",
  ownerOnly: "agent_dial_owner_only",
};

/** The Telemarketing Sales Rule cap. Checked again here: the app validates before queuing, but
 *  a queued command is a message, and a message can be wrong or old. */
const ABANDON_CAP_PCT = 3;

/**
 * Applies a campaign's dialing settings.
 *
 * Two routes, because VICIdial's API covers only part of a campaign: pacing goes through
 * update_campaign, and the five settings it has no parameter for are written to their columns
 * directly, under a grant that covers those columns and nothing else.
 */
async function updateCampaign(cmd: CommandRow, api: VicidialApi, pool: Pool): Promise<CommandOutcome> {
  const p = cmd.payload as unknown as UpdateCampaignPayload;
  if (!p?.campaignId) return { ok: false, retryable: false, result: { error: "No campaign was named" } };

  if (p.maxDropPct !== undefined && p.maxDropPct > ABANDON_CAP_PCT) {
    return { ok: false, retryable: false, result: { error: `Refused: ${p.maxDropPct}% abandoned calls is above the ${ABANDON_CAP_PCT}% daily limit` } };
  }
  if (p.dialMethod === "MANUAL" && (p.linesPerAgent ?? 0) > 1) {
    return { ok: false, retryable: false, result: { error: "Refused: manual dialing cannot run several lines per agent" } };
  }
  // These two are enums in VICIdial. An unexpected value would be silently coerced to the
  // column's default, quietly turning a restriction off, so refuse it instead.
  if (p.ownerOnly !== undefined && !OWNER_ONLY_VALUES.includes(p.ownerOnly)) {
    return { ok: false, retryable: false, result: { error: `Refused: "${p.ownerOnly}" is not a lead-ownership rule` } };
  }
  if (p.recording !== undefined && !RECORDING_VALUES.includes(p.recording)) {
    return { ok: false, retryable: false, result: { error: `Refused: "${p.recording}" is not a recording mode` } };
  }

  const viaApi: Record<string, string | number | undefined> = {
    campaign_id: p.campaignId,
    dial_method: p.dialMethod,
    auto_dial_level: p.linesPerAgent,
    adaptive_maximum_level: p.maxLinesPerAgent,
    hopper_level: p.hopperLevel,
    dial_timeout: p.dialTimeoutSec,
    campaign_cid: p.campaignCid,
    active: p.active === undefined ? undefined : p.active ? "Y" : "N",
  };
  const sent = Object.entries(viaApi)
    .filter(([k, v]) => k !== "campaign_id" && v !== undefined)
    .map(([k]) => k);

  if (sent.length > 0) {
    const res = await api.call("update_campaign", viaApi);
    if (!res.ok) return { ok: false, result: { error: res.error, step: "update_campaign" } };
  }

  const sets: string[] = [];
  const values: Array<string | number> = [];
  const direct: string[] = [];

  for (const [field, column] of Object.entries(DIRECT_COLUMNS)) {
    const value = (p as Record<string, unknown>)[field];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(typeof value === "boolean" ? (value ? "Y" : "N") : (value as string | number));
    direct.push(column);
  }

  if (sets.length > 0) {
    values.push(p.campaignId);
    try {
      await pool.execute(`UPDATE vicidial_campaigns SET ${sets.join(", ")} WHERE campaign_id = ?`, values);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        result: {
          error: /command denied/i.test(message) ? `The agent may not write ${direct.join(", ")}. Grant UPDATE on those columns.` : message,
          step: "direct columns",
          appliedViaApi: sent,
        },
      };
    }
  }

  return { ok: true, result: { campaignId: p.campaignId, viaApi: sent, viaColumns: direct } };
}

/**
 * Claim and run whatever is waiting. Returns how many were handled, so the caller can stay
 * quiet on an idle queue.
 */
export async function processCommands(db: SupabaseClient, pool: Pool, cfg: Config, log: (msg: string) => void): Promise<number> {
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
      outcome = await execute(cmd, api, pool);
    } catch (err) {
      outcome = { ok: false, result: { error: err instanceof Error ? err.message : String(err) } };
    }

    const attempts = row.attempts + 1;
    const retryable = !outcome.ok && outcome.retryable !== false && attempts < MAX_ATTEMPTS;

    await db
      .from("commands")
      .update({
        status: outcome.ok ? "done" : retryable ? "queued" : "failed",
        result: outcome.result,
        finished_at: outcome.ok || !retryable ? new Date().toISOString() : null,
        claimed_by: retryable ? null : cfg.dialerName,
      })
      .eq("id", row.id);

    // Creating an agent carries their VICIdial password. It is needed for the one call that
    // creates the account and never again, so it is removed from the stored payload as soon as
    // the command finishes rather than being kept in the queue for ever.
    if (cmd.type === "create_agent" && !retryable && "password" in cmd.payload) {
      const { password, ...rest } = cmd.payload as { password?: string };
      void password;
      await db.from("commands").update({ payload: rest }).eq("id", row.id);
    }

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
