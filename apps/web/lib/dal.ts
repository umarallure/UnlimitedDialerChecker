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
  if (!listed) redirect("/not-authorized");

  if (claims.aal !== "aal2") redirect("/mfa");

  return { userId: claims.sub, email: String(claims.email ?? "") };
});
