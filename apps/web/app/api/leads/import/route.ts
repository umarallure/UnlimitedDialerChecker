import { z } from "zod";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const Lead = z.object({
  phoneNumber: z.string().regex(/^[2-9]\d{2}[2-9]\d{6}$/, "Not a dialable US number"),
  firstName: z.string().max(30).optional(),
  lastName: z.string().max(30).optional(),
  address1: z.string().max(100).optional(),
  city: z.string().max(50).optional(),
  state: z.string().length(2).optional(),
  postalCode: z.string().max(10).optional(),
  email: z.string().max(70).optional(),
  altPhone: z.string().max(20).optional(),
  comments: z.string().max(255).optional(),
  vendorLeadCode: z.string().max(20).optional(),
});

const Body = z.object({
  listId: z.number().int().positive(),
  owner: z.string().max(20).optional(),
  campaignId: z.string().max(20).optional(),
  dncCheck: z.boolean().default(true),
  duplicateCheck: z.enum(["DUPLIST", "DUPCAMP", "DUPSYS", "NONE"]).default("DUPLIST"),
  fileName: z.string().max(200).optional(),
  leads: z.array(Lead).min(1).max(20000),
});

/** Leads per command. Small enough to keep each queue row modest, large enough that a big
 *  import is a handful of commands rather than hundreds. */
const CHUNK = 100;

/**
 * Queues a lead import. The leads are not sent to VICIdial here: they are split into commands
 * that the dialer agent runs locally, one `add_lead` call per lead.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the file and try again." }, { status: 400 });
  }
  const b = parsed.data;

  const supabase = await createClient();

  const { data: list, error: listError } = await supabase.from("dialer_lists").select("list_id, campaign_id, active").eq("list_id", b.listId).maybeSingle();
  if (listError) return Response.json({ error: listError.message }, { status: 500 });
  if (!list) return Response.json({ error: "That list does not exist on the dialer." }, { status: 400 });

  const { data: job, error: jobError } = await supabase
    .from("lead_imports")
    .insert({
      list_id: b.listId,
      owner: b.owner ?? null,
      source: "csv",
      file_name: b.fileName ?? null,
      total: b.leads.length,
      created_by: admin.email,
    })
    .select("id")
    .single();
  if (jobError || !job) return Response.json({ error: jobError?.message ?? "Could not start the import." }, { status: 500 });

  const chunks: (typeof b.leads)[] = [];
  for (let i = 0; i < b.leads.length; i += CHUNK) chunks.push(b.leads.slice(i, i + CHUNK));

  const { error: cmdError } = await supabase.from("commands").insert(
    chunks.map((leads) => ({
      type: "add_leads",
      import_id: job.id,
      created_by: admin.email,
      payload: {
        listId: b.listId,
        owner: b.owner,
        campaignId: b.campaignId ?? list.campaign_id,
        dncCheck: b.dncCheck,
        duplicateCheck: b.duplicateCheck,
        leads,
      },
    })),
  );

  if (cmdError) {
    await supabase.from("lead_imports").update({ finished_at: new Date().toISOString(), failed: b.leads.length }).eq("id", job.id);
    return Response.json({ error: cmdError.message }, { status: 500 });
  }

  return Response.json({ importId: job.id, total: b.leads.length, commands: chunks.length });
}

/** Progress for one import. */
export async function GET(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: "Admin access with MFA is required." }, { status });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No import id." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_imports")
    .select("id, list_id, owner, total, added, duplicates, failed, created_at, finished_at")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Not found." }, { status: 404 });

  const { count: pending } = await supabase
    .from("commands")
    .select("id", { count: "exact", head: true })
    .eq("import_id", id)
    .in("status", ["queued", "running"]);

  return Response.json({ ...data, pending: pending ?? 0 });
}
