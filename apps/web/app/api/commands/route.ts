import { z } from "zod";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Verbs the dialer agent implements. Adding one here without implementing it queues a command
 *  that can only fail, so this list and the agent's switch stay in step. */
const COMMAND_TYPES = ["api_ping", "resync", "create_agent"] as const;

const Body = z.object({
  type: z.enum(COMMAND_TYPES),
  payload: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Queues work for the dialer. The app never calls VICIdial itself: the agent on the dialer
 * picks this up within a few seconds and runs it over localhost.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown command." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .insert({ type: parsed.data.type, payload: parsed.data.payload, created_by: admin.email })
    .select("id, type, status, created_at")
    .single();

  if (error) return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  return Response.json(data);
}

/** Poll one command's progress. */
export async function GET(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: "Admin access with MFA is required." }, { status });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No command id." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .select("id, type, status, result, created_at, started_at, finished_at, attempts")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json(data);
}
