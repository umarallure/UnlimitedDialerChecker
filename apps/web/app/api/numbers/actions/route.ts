import { z } from "zod";
import { getAdminForApi } from "@/lib/dal";
import { NUMBER_ACTIONS } from "@/lib/number-actions";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  ids: z.array(z.uuid()).min(1).max(1000),
  action: z.enum(NUMBER_ACTIONS),
  payload: z
    .object({
      value: z.union([z.boolean(), z.string().max(500), z.number().int().min(0).max(500), z.null()]).optional(),
      reason: z.string().max(300).optional(),
    })
    .default({}),
});

/** Applies an action to one or many numbers through the did_action RPC (atomic, admin + MFA, audited). */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request. Choose numbers and an action." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("did_action", {
    p_ids: parsed.data.ids,
    p_action: parsed.data.action,
    p_payload: parsed.data.payload,
  });

  if (error) {
    const clientError = error.code === "22023" || error.code === "22P02";
    return Response.json({ error: error.message }, { status: clientError ? 400 : error.code === "42501" ? 403 : 500 });
  }
  return Response.json(data);
}
