import { z } from "zod";
import { LeadLinkError, toWebFormAddress } from "@/lib/crm/lead-link";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  id: z.uuid(),
  /** As typed, with {id} where the lead id goes. Empty removes the button. */
  template: z.string().max(500),
  /** Campaigns to put the link on. Usually every agent campaign. */
  campaignIds: z.array(z.string().max(20)).max(50).default([]),
});

/**
 * Saves the CRM lead link and puts it on the given campaigns.
 *
 * The agent screen's WEB FORM button opens this address with the lead's own id substituted, so
 * an agent reaches the CRM record for whoever they are speaking to without searching for them.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the link." }, { status: 400 });
  const { id, template, campaignIds } = parsed.data;

  let address = "";
  if (template.trim()) {
    try {
      address = toWebFormAddress(template);
    } catch (err) {
      return Response.json({ error: err instanceof LeadLinkError ? err.message : "That link cannot be used." }, { status: 400 });
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("crm_connections").update({ lead_url_template: template.trim() || null }).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (campaignIds.length === 0) return Response.json({ saved: true, campaigns: 0 });

  const { error: cmdError } = await supabase.from("commands").insert(
    campaignIds.map((campaignId) => ({
      type: "update_campaign",
      created_by: admin.email,
      payload: { campaignId, webFormAddress: address },
    })),
  );
  if (cmdError) return Response.json({ error: cmdError.message }, { status: 500 });

  return Response.json({ saved: true, campaigns: campaignIds.length });
}
