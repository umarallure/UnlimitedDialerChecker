import { z } from "zod";
import { DIAL_METHODS, TSR_MAX_DROP_PCT, validateDialPlan } from "@udc/policy";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  campaignId: z.string().min(1).max(20),
  dialMethod: z.enum(DIAL_METHODS),
  linesPerAgent: z.number().min(0).max(10),
  maxLinesPerAgent: z.number().min(1).max(10),
  maxDropPct: z.number().min(0).max(TSR_MAX_DROP_PCT),
  dialTimeoutSec: z.number().int().min(10).max(120),
  dropCallSeconds: z.number().int().min(1).max(20),
  hopperLevel: z.number().int().min(1).max(2000),
  availableOnlyTally: z.boolean(),
  plannedAgents: z.number().int().min(0).max(500),
  reservedLines: z.number().int().min(0).max(500),
});

/**
 * Saves the dialing plan for one campaign. A plan with errors is refused outright — an
 * abandon rate over the rule, or more lines than the dialer has trunks, is never worth storing.
 * Saving does not change VICIdial; applying a plan is gated like rotation enforcement.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the values and try again." }, { status: 400 });
  const b = parsed.data;

  const supabase = await createClient();
  const { data: live } = await supabase.from("campaigns_live").select("server_trunks").eq("campaign_id", b.campaignId).maybeSingle();
  const { data: current } = await supabase.from("dial_settings").select("carrier_channels").eq("campaign_id", b.campaignId).maybeSingle();

  const capacity = {
    agents: b.plannedAgents,
    // Until the agent has synced the dialer's trunk count, judge the plan on the carrier alone.
    serverTrunks: live?.server_trunks ?? Number.MAX_SAFE_INTEGER,
    carrierChannels: current?.carrier_channels ?? 300,
    reservedLines: b.reservedLines,
  };

  const issues = validateDialPlan(b, capacity);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) return Response.json({ error: errors[0].message, issues: errors }, { status: 400 });

  const { error } = await supabase.from("dial_settings").upsert(
    {
      campaign_id: b.campaignId,
      dial_method: b.dialMethod,
      lines_per_agent: b.linesPerAgent,
      max_lines_per_agent: b.maxLinesPerAgent,
      max_drop_pct: b.maxDropPct,
      dial_timeout_sec: b.dialTimeoutSec,
      drop_call_seconds: b.dropCallSeconds,
      hopper_level: b.hopperLevel,
      available_only_tally: b.availableOnlyTally,
      planned_agents: b.plannedAgents,
      reserved_lines: b.reservedLines,
      updated_by: admin.email,
    },
    { onConflict: "campaign_id" },
  );
  if (error) return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });

  return Response.json({ saved: true, warnings: issues.filter((i) => i.level !== "error").length });
}
