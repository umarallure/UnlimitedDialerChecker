import { z } from "zod";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  recipients: z.array(z.email()).min(1, "Add at least one recipient").max(10),
  immediate_enabled: z.boolean(),
  digest_enabled: z.boolean(),
  digest_hour_et: z.number().int().min(0).max(23),
});

/** Update who gets alert emails and when. Writes run under the admin's session, so RLS applies. */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the email addresses and try again." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select("recipients, immediate_enabled, digest_enabled, digest_hour_et")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
