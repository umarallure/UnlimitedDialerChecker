import { getAdminForApi } from "@/lib/dal";
import { runPreview } from "@/lib/rotation";
import { createClient } from "@/lib/supabase/server";

/**
 * Runs the lifecycle engine over the pool and records the result as a dry run.
 * Read-only against the number pool: nothing is promoted, cooled or retired here.
 */
export async function POST() {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const supabase = await createClient();
  try {
    const result = await runPreview(supabase, admin.email);
    return Response.json({ runId: result.runId, evaluated: result.evaluated, skipped: result.skipped, proposals: result.proposals.length });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "The engine could not finish." }, { status: 500 });
  }
}
