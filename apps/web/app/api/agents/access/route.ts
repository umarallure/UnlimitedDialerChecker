import { NextResponse } from "next/server";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Give somebody who can already sign in access to the dialer screen.
 *
 * Their VICIdial and phone passwords go straight into Vault inside the database function; they
 * are never stored in a table here and never read back except for that one agent's own session.
 */

export const dynamic = "force-dynamic";

const USER = /^[A-Za-z0-9_]{2,20}$/;
const PHONE = /^[A-Za-z0-9_]{2,20}$/;
const CAMPAIGN = /^[A-Z0-9_]{2,8}$/;

export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return NextResponse.json({ error: "Not allowed." }, { status });

  const body = (await request.json().catch(() => null)) as Record<string, string> | null;
  if (!body) return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });

  const email = (body.email ?? "").trim().toLowerCase();
  const agentUser = (body.agentUser ?? "").trim();
  const agentPass = body.agentPass ?? "";
  const phoneLogin = (body.phoneLogin ?? "").trim();
  const phonePass = body.phonePass ?? "";
  const campaignId = (body.campaignId ?? "").trim();

  if (!email.includes("@")) return NextResponse.json({ error: "Give the email they sign in with." }, { status: 400 });
  if (!USER.test(agentUser)) return NextResponse.json({ error: "The VICIdial username is 2 to 20 letters, numbers or underscores." }, { status: 400 });
  if (!PHONE.test(phoneLogin)) return NextResponse.json({ error: "The phone login is 2 to 20 letters, numbers or underscores." }, { status: 400 });
  if (agentPass.length < 4 || phonePass.length < 4) return NextResponse.json({ error: "Both passwords are required." }, { status: 400 });
  if (campaignId && !CAMPAIGN.test(campaignId)) return NextResponse.json({ error: "That campaign id is not one VICIdial would accept." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_app_agent_by_email", {
    p_email: email,
    p_agent_user: agentUser,
    p_agent_pass: agentPass,
    p_phone_login: phoneLogin,
    p_phone_pass: phonePass,
    p_campaign_id: campaignId || null,
  });

  if (error) {
    // The "invite them first" case is the common one and reads perfectly well as-is.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, email, agentUser });
}
