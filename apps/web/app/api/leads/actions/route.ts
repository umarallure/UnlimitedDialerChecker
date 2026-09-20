import { z } from "zod";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** The list leads are moved to when they are taken out of a campaign. It belongs to the
 *  inactive TEMPLATE campaign, so nothing there is ever dialled. */
export const PARKED_LIST = 900;

const Body = z.object({
  leadIds: z.array(z.number().int().positive()).min(1).max(5000),
  action: z.enum(["park", "requeue", "reassign", "move"]),
  /** Who the leads should belong to, for reassign. */
  owner: z.string().max(20).optional(),
  /** Where they should go, for reassign and move. */
  listId: z.number().int().positive().optional(),
});

/**
 * Acts on leads through the dialer agent.
 *
 * VICIdial has no way to delete a lead, and deleting one would take its call history with it
 * anyway. Taking leads out of a campaign moves them to the parked list instead, which is
 * reversible and leaves the history intact.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the selection." }, { status: 400 });
  const { leadIds, action, owner, listId } = parsed.data;

  let set: { status?: string; owner?: string | null; listId?: number };
  switch (action) {
    case "park":
      set = { listId: PARKED_LIST };
      break;
    case "requeue":
      // Back to NEW so the campaign's dial_statuses picks them up again.
      set = { status: "NEW" };
      break;
    case "reassign":
      if (!owner || !listId) return Response.json({ error: "Choose the agent to hand these to." }, { status: 400 });
      set = { owner, listId };
      break;
    case "move":
      if (!listId) return Response.json({ error: "Choose a list." }, { status: 400 });
      set = { listId };
      break;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commands")
    .insert({ type: "update_leads", created_by: admin.email, payload: { leadIds, set } })
    .select("id")
    .single();

  if (error) return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  return Response.json({ id: data.id, leads: leadIds.length, action });
}
