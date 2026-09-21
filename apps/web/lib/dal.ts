import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Admin = { userId: string; email: string };

/**
 * Every admin page and route calls this. Order matters:
 * signed in → on the allowlist → MFA verified (aal2). RLS enforces the same rules in the DB.
 */
export const requireAdmin = cache(async (): Promise<Admin> => {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");

  const { data: listed } = await supabase.rpc("is_listed_admin");
  if (!listed) {
    // An agent landing on an admin page belongs on their own screen, not on an error page.
    const { data: isAgent } = await supabase.rpc("is_listed_agent");
    redirect(isAgent ? "/dialer" : "/not-authorized");
  }

  if (claims.aal !== "aal2") redirect("/mfa");

  return { userId: claims.sub, email: String(claims.email ?? "") };
});

export type AgentSession = {
  userId: string;
  email: string;
  agentUser: string;
  phoneLogin: string;
  campaignId: string | null;
};

/**
 * The guard for the dialer screen.
 *
 * Deliberately does not require aal2. Admins carry the MFA requirement because they can change
 * how the dialer behaves; an agent can only work the leads already assigned to them, and RLS
 * holds that line in the database. An admin who is also on the agent roster can use the screen.
 */
export const requireAgent = cache(async (): Promise<AgentSession> => {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");

  const { data } = await supabase
    .from("app_agents")
    .select("agent_user, phone_login, campaign_id, active")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (!data?.active) redirect("/not-authorized");

  return {
    userId: claims.sub,
    email: String(claims.email ?? ""),
    agentUser: data.agent_user as string,
    phoneLogin: data.phone_login as string,
    campaignId: (data.campaign_id as string | null) ?? null,
  };
});

/** Route-handler variant of `requireAgent`: an HTTP status rather than a redirect. */
export async function getAgentForApi(): Promise<
  { agent: AgentSession; status: 200 } | { agent: null; status: 401 | 403 }
> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return { agent: null, status: 401 };

  const { data } = await supabase
    .from("app_agents")
    .select("agent_user, phone_login, campaign_id, active")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (!data?.active) return { agent: null, status: 403 };

  return {
    agent: {
      userId: claims.sub,
      email: String(claims.email ?? ""),
      agentUser: data.agent_user as string,
      phoneLogin: data.phone_login as string,
      campaignId: (data.campaign_id as string | null) ?? null,
    },
    status: 200,
  };
}

/** Route-handler variant: returns an HTTP status instead of redirecting. */
export async function getAdminForApi(): Promise<{ admin: Admin; status: 200 } | { admin: null; status: 401 | 403 }> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) return { admin: null, status: 401 };
  const { data: listed } = await supabase.rpc("is_listed_admin");
  if (!listed || claims.aal !== "aal2") return { admin: null, status: 403 };
  return { admin: { userId: claims.sub, email: String(claims.email ?? "") }, status: 200 };
}
