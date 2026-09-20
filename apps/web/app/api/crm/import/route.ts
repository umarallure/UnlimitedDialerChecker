import { z } from "zod";
import { explainCrmError, listColumns, listTables, withCrm } from "@/lib/crm/connection";
import { FILTER_OPERATORS, buildSelect, type Filter } from "@/lib/crm/query";
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
  limit: z.number().int().min(1).max(20000).default(1000),
  listId: z.number().int().positive(),
  owner: z.string().max(20).optional(),
  dncCheck: z.boolean().default(true),
  duplicateCheck: z.enum(["DUPLIST", "DUPCAMP", "DUPSYS", "NONE"]).default("DUPLIST"),
});

const CHUNK = 100;
const TEXT_FIELDS = ["firstName", "lastName", "address1", "city", "state", "postalCode", "email", "altPhone", "comments", "vendorLeadCode"] as const;
const MAX_LENGTH: Record<string, number> = { firstName: 30, lastName: 30, address1: 100, city: 50, state: 2, postalCode: 10, email: 70, altPhone: 20, comments: 255, vendorLeadCode: 20 };

/**
 * Reads matching rows from the CRM and queues them for the dialer.
 *
 * Nothing is written to the CRM — access there is read-only — so which source rows have been
 * taken is recorded here instead, and those rows are skipped next time.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the settings." }, { status: 400 });
  const b = parsed.data;

  const supabase = await createClient();
  const { data: conn } = await supabase.from("crm_connections").select("source_schema, name").eq("id", b.id).maybeSingle();
  if (!conn) return Response.json({ error: "That connection no longer exists." }, { status: 404 });

  const { data: list } = await supabase.from("dialer_lists").select("list_id, campaign_id").eq("list_id", b.listId).maybeSingle();
  if (!list) return Response.json({ error: "That list does not exist on the dialer." }, { status: 400 });

  let excludeIds: string[] = [];
  if (b.skipImported) {
    const { data } = await supabase.from("crm_imported_rows").select("source_id").eq("connection_id", b.id).limit(5000);
    excludeIds = (data ?? []).map((r) => r.source_id);
  }

  let sourceRows: Record<string, unknown>[];
  try {
    sourceRows = await withCrm(b.id, async (client) => {
      const tables = await listTables(client, conn.source_schema);
      const columns = (await listColumns(client, conn.source_schema, b.table)).map((c) => c.name);
      const wanted = [...new Set([b.sourceIdColumn, ...Object.values(b.columnMap).filter(Boolean)])];
      const query = buildSelect({
        schema: conn.source_schema,
        table: b.table,
        columns: wanted,
        knownColumns: columns,
        knownTables: tables,
        filters: b.filters as Filter[],
        excludeIds: excludeIds.length ? { column: b.sourceIdColumn, ids: excludeIds } : undefined,
        limit: b.limit,
      });
      const { rows } = await client.query(query.text, query.values);
      return rows;
    });
  } catch (err) {
    const message = explainCrmError(err);
    await supabase.from("crm_connections").update({ status: "error", last_error: message }).eq("id", b.id);
    return Response.json({ error: message }, { status: 400 });
  }

  const phoneCol = b.columnMap.phoneNumber;
  if (!phoneCol) return Response.json({ error: "No column is mapped to the phone number." }, { status: 400 });

  const leads: Record<string, string>[] = [];
  const taken: { source_id: string; phone: string }[] = [];
  let unusable = 0;
  const seen = new Set<string>();

  for (const row of sourceRows) {
    const phone = normalizePhone(String(row[phoneCol] ?? ""));
    const sourceId = String(row[b.sourceIdColumn] ?? "");
    if (!phone || !sourceId || seen.has(phone)) {
      unusable++;
      continue;
    }
    seen.add(phone);

    const lead: Record<string, string> = { phoneNumber: phone };
    for (const field of TEXT_FIELDS) {
      const col = b.columnMap[field];
      if (!col) continue;
      const raw = row[col];
      if (raw === null || raw === undefined) continue;
      const value = String(raw).trim();
      if (!value) continue;
      lead[field] = field === "state" ? value.slice(0, 2).toUpperCase() : value.slice(0, MAX_LENGTH[field] ?? 255);
    }
    leads.push(lead);
    taken.push({ source_id: sourceId, phone });
  }

  if (leads.length === 0) {
    return Response.json({ error: unusable > 0 ? `None of the ${unusable} rows had a usable phone number.` : "No rows matched those filters." }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabase
    .from("lead_imports")
    .insert({ list_id: b.listId, owner: b.owner ?? null, source: "crm", file_name: `${conn.name} · ${b.table}`, total: leads.length, created_by: admin.email })
    .select("id")
    .single();
  if (jobError || !job) return Response.json({ error: jobError?.message ?? "Could not start the import." }, { status: 500 });

  const chunks: Record<string, string>[][] = [];
  for (let i = 0; i < leads.length; i += CHUNK) chunks.push(leads.slice(i, i + CHUNK));

  const { error: cmdError } = await supabase.from("commands").insert(
    chunks.map((batch) => ({
      type: "add_leads",
      import_id: job.id,
      created_by: admin.email,
      payload: { listId: b.listId, owner: b.owner, campaignId: list.campaign_id, dncCheck: b.dncCheck, duplicateCheck: b.duplicateCheck, leads: batch },
    })),
  );
  if (cmdError) {
    await supabase.from("lead_imports").update({ finished_at: new Date().toISOString(), failed: leads.length }).eq("id", job.id);
    return Response.json({ error: cmdError.message }, { status: 500 });
  }

  // Remember what was taken so the next run skips it, whatever the dialer makes of each lead.
  await supabase.from("crm_imported_rows").upsert(
    taken.map((t) => ({ connection_id: b.id, source_id: t.source_id, phone: t.phone })),
    { onConflict: "connection_id,source_id" },
  );

  await supabase
    .from("crm_connections")
    .update({ source_table: b.table, column_map: b.columnMap, filters: b.filters, last_import_at: new Date().toISOString(), status: "ok", last_error: null })
    .eq("id", b.id);

  return Response.json({ importId: job.id, total: leads.length, commands: chunks.length, unusable });
}
