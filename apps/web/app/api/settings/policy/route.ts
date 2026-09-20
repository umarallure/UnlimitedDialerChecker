import { z } from "zod";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({ requireCleanReputation: z.boolean() });

/**
 * Updates one rotation policy switch. Merged into the settings JSON so the rest of
 * the policy is untouched, and stamped with who changed it.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("policies").select("id, settings").eq("is_active", true).maybeSingle();
  if (readError || !current) return Response.json({ error: readError?.message ?? "No active policy." }, { status: 500 });

  const settings = { ...(current.settings as Record<string, unknown>), requireCleanReputation: parsed.data.requireCleanReputation };
  const { error } = await supabase.from("policies").update({ settings, updated_by: admin.email }).eq("id", current.id);
  if (error) return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });

  return Response.json({ requireCleanReputation: parsed.data.requireCleanReputation });
}
