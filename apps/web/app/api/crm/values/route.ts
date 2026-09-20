import { explainCrmError, listColumns, withCrm } from "@/lib/crm/connection";
import { quoteIdent } from "@/lib/crm/query";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Enough to fill a dropdown; a column with more distinct values than this is not a category. */
const MAX_VALUES = 200;

/**
 * The distinct values of one column, with counts, so a filter can be a dropdown of what is
 * actually in the data rather than a box to type a guess into.
 */
export async function GET(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: "Admin access with MFA is required." }, { status });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const table = url.searchParams.get("table");
  const column = url.searchParams.get("column");
  if (!id || !table || !column) return Response.json({ error: "Missing connection, table or column." }, { status: 400 });

  const supabase = await createClient();
  const { data: conn } = await supabase.from("crm_connections").select("source_schema").eq("id", id).maybeSingle();
  if (!conn) return Response.json({ error: "That connection no longer exists." }, { status: 404 });

  try {
    const values = await withCrm(id, async (client) => {
      const columns = await listColumns(client, conn.source_schema, table);
      // The identifier must be one the database just reported; nothing else reaches the query.
      if (!columns.some((c) => c.name === column)) throw new Error(`The column "${column}" is not in that table.`);

      const { rows } = await client.query<{ value: string | null; n: string }>(
        `select ${quoteIdent(column)}::text as value, count(*) as n
           from ${quoteIdent(conn.source_schema)}.${quoteIdent(table)}
          group by 1 order by count(*) desc limit ${MAX_VALUES}`,
      );
      return rows.map((r) => ({ value: r.value, count: Number(r.n) }));
    });

    return Response.json({ values, truncated: values.length === MAX_VALUES });
  } catch (err) {
    return Response.json({ error: explainCrmError(err) }, { status: 400 });
  }
}
