import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Manually resolve an open alert. If the problem persists, the next health check opens a new one. */
export async function POST(_request: Request, ctx: RouteContext<"/api/alerts/[id]/resolve">) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "Unknown alert." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alerts")
    .update({ resolved_at: new Date().toISOString(), resolved_by: admin.email })
    .eq("id", Number(id))
    .is("resolved_at", null)
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ error: "This alert is already resolved." }, { status: 409 });
  return Response.json({ resolved: Number(id) });
}
