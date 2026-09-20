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
    case "resync":
      // Handled by the sync loops; queuing it just marks the request.
      return { ok: true, result: { note: "Sync loops run on their own schedule" } };
    default:
      return { ok: false, result: { error: `This dialer agent does not implement "${cmd.type}"` } };
  }
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
    .select("id, type, payload, attempts")
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

    handled++;
    log(`${cmd.type} ${outcome.ok ? "done" : retryable ? `failed, retrying (${attempts}/${MAX_ATTEMPTS})` : "failed"}`);
  }

  return handled;
}
