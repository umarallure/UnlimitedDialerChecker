import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LiveAgent } from "./vicidial";

/**
 * A copy of what each agent is doing, written into the CRM's own Supabase project.
 *
 * The CRM has its own dialer screen, and its agents are its own users. Reading this app's project
 * from there would mean a session in one project authorising a read in another, which Supabase
 * auth does not do. So the state is written to both places instead, and each app reads its own
 * under its own row-level security.
 *
 * **Best effort, always.** The CRM being unreachable, misconfigured or slow must never stop this
 * agent syncing the dialer it is responsible for. Every failure here returns a message for the
 * log and nothing else — the caller does not get an exception to handle, because there is no
 * useful handling for "somebody else's database is down".
 */

export type CrmMirror = {
  write: (agents: LiveAgent[], now: string) => Promise<string | null>;
};

/** Null when no CRM project is configured, which is a normal state rather than an error. */
export function createCrmMirror(): CrmMirror | null {
  const url = process.env.CRM_SUPABASE_URL;
  const key = process.env.CRM_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const db: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async write(agents, now) {
      try {
        if (agents.length > 0) {
          const { error } = await db.from("dialer_agent_state").upsert(
            agents.map((a) => ({
              agent_user: a.user,
              status: a.status,
              pause_code: a.pauseCode,
              campaign_id: a.campaignId,
              lead_id: a.leadId,
              calls_today: a.callsToday,
              state_since: a.stateSince?.toISOString() ?? null,
              updated_at: now,
            })),
            { onConflict: "agent_user" },
          );
          if (error) return `crm mirror upsert: ${error.message}`;
        }

        // An agent who logged out disappears from VICIdial's live table; the CRM's call bar reads
        // staleness from `updated_at`, but a row left behind would still show their last state as
        // though it were current.
        const present = agents.map((a) => a.user);
        const del = db.from("dialer_agent_state").delete();
        const { error } = present.length
          ? await del.not("agent_user", "in", `(${present.map((u) => `"${u.replace(/"/g, "")}"`).join(",")})`)
          : await del.neq("agent_user", "");
        if (error) return `crm mirror prune: ${error.message}`;

        return null;
      } catch (err) {
        return `crm mirror: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
