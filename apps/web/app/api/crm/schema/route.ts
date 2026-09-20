import { explainCrmError, listColumns, listTables, withCrm } from "@/lib/crm/connection";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Tables in the connected schema, and the columns of one table when `table` is given. */
export async function GET(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: "Admin access with MFA is required." }, { status });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const table = url.searchParams.get("table");
  if (!id) return Response.json({ error: "No connection id." }, { status: 400 });

  const supabase = await createClient();
  const { data: conn } = await supabase.from("crm_connections").select("source_schema").eq("id", id).maybeSingle();
  const schema = conn?.source_schema ?? "public";

  try {
    const out = await withCrm(id, async (client) => ({
      tables: await listTables(client, schema),
      columns: table ? await listColumns(client, schema, table) : [],
    }));
    return Response.json({ schema, ...out });
  } catch (err) {
    const message = explainCrmError(err);
    await supabase.from("crm_connections").update({ status: "error", last_error: message }).eq("id", id);
    return Response.json({ error: message }, { status: 400 });
  }
}
