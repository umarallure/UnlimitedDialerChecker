import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Run the health checks now instead of waiting for the 15-minute schedule. */
export async function POST() {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_health_checks");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
