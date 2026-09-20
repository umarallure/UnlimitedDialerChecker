import { z } from "zod";
import { explainCrmError, listColumns, listTables, withCrm } from "@/lib/crm/connection";
import { FILTER_OPERATORS, buildSelect, kindOf, type ColumnKind, type Filter } from "@/lib/crm/query";
import { normalizePhone } from "@/lib/import/leads-csv";
import { getAdminForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

const FilterSchema = z.object({
  column: z.string().min(1).max(63),
  operator: z.enum(Object.keys(FILTER_OPERATORS) as [keyof typeof FILTER_OPERATORS]),
  value: z.string().max(2000).optional(),
});

const Body = z.object({
  id: z.uuid(),
  table: z.string().min(1).max(63),
  columnMap: z.record(z.string(), z.string()),
  sourceIdColumn: z.string().min(1).max(63),
  filters: z.array(FilterSchema).max(20).default([]),
  skipImported: z.boolean().default(true),
  limit: z.number().int().min(1).max(20000).default(25),
});

export type PreviewRow = { sourceId: string; phone: string | null; values: Record<string, string | null> };

/**
 * Reads matching rows from the CRM without importing anything.
 *
 * Every identifier is checked against what the database reports before it reaches a query, and
 * rows already imported through this connection are left out by default, so running a preview
 * twice does not show work that is already done.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the filters." }, { status: 400 });
  const b = parsed.data;

  const supabase = await createClient();
  const { data: conn } = await supabase.from("crm_connections").select("source_schema").eq("id", b.id).maybeSingle();
  if (!conn) return Response.json({ error: "That connection no longer exists." }, { status: 404 });

  // Exclusions are capped: past a few thousand this belongs in a watermark column, not a list.
  let excludeIds: string[] = [];
  if (b.skipImported) {
    const { data } = await supabase.from("crm_imported_rows").select("source_id").eq("connection_id", b.id).limit(5000);
    excludeIds = (data ?? []).map((r) => r.source_id);
  }

  try {
    const result = await withCrm(b.id, async (client) => {
      const tables = await listTables(client, conn.source_schema);
      const columnInfo = await listColumns(client, conn.source_schema, b.table);
      const columns = columnInfo.map((c) => c.name);
      const kinds: Record<string, ColumnKind> = Object.fromEntries(columnInfo.map((c) => [c.name, kindOf(c.type)]));

      const wanted = [...new Set([b.sourceIdColumn, ...Object.values(b.columnMap).filter(Boolean)])];
      const query = buildSelect({
        schema: conn.source_schema,
        table: b.table,
        columns: wanted,
        knownColumns: columns,
        knownTables: tables,
        kinds,
        filters: b.filters as Filter[],
        excludeIds: excludeIds.length ? { column: b.sourceIdColumn, ids: excludeIds } : undefined,
        limit: b.limit,
      });

      const { rows } = await client.query(query.text, query.values);
      return { rows, sql: query.text };
    });

    const phoneCol = b.columnMap.phoneNumber;
    const rows: PreviewRow[] = result.rows.map((r: Record<string, unknown>) => {
      const values: Record<string, string | null> = {};
      for (const [field, col] of Object.entries(b.columnMap)) {
        if (!col) continue;
        const v = r[col];
        values[field] = v === null || v === undefined ? null : String(v);
      }
      return {
        sourceId: String(r[b.sourceIdColumn] ?? ""),
        phone: phoneCol ? normalizePhone(String(r[phoneCol] ?? "")) : null,
        values,
      };
    });

    return Response.json({
      rows,
      total: rows.length,
      unusable: rows.filter((r) => !r.phone).length,
      excluded: excludeIds.length,
    });
  } catch (err) {
    return Response.json({ error: explainCrmError(err) }, { status: 400 });
  }
}
