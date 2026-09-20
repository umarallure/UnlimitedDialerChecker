import { z } from "zod";
import { explainCrmError, listTables, withRawCrm } from "@/lib/crm/connection";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  name: z.string().min(1).max(60),
  connectionString: z.string().min(20).max(500),
  schema: z.string().max(60).default("public"),
});

/**
 * Saves a CRM connection after proving it works and is readable.
 * The connection string is tested first and then handed straight to Vault — it is never stored
 * in an ordinary column and never sent back to the browser.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
  const { name, connectionString, schema } = parsed.data;

  let tables: string[];
  try {
    tables = await withRawCrm(connectionString, (c) => listTables(c, schema));
  } catch (err) {
    return Response.json({ error: explainCrmError(err) }, { status: 400 });
  }

  if (tables.length === 0) {
    return Response.json(
      { error: `Connected, but that role cannot read any table in "${schema}". Grant it SELECT on the table holding your leads.` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("crm_save_connection", { p_name: name, p_conn: connectionString, p_actor: admin.email });
  if (error) return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });

  await supabase.from("crm_connections").update({ source_schema: schema, status: "ok", last_tested_at: new Date().toISOString() }).eq("id", id);

  return Response.json({ id, tables });
}

/** Disconnect: the credential is destroyed here. Their side still needs the role dropping. */
export async function DELETE(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: "Admin access with MFA is required." }, { status });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "No connection id." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_forget_connection", { p_id: id });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ forgotten: true });
}
