import { z } from "zod";
import { getAdminForApi } from "@/lib/dal";
import { buildImport, summarize, type ExistingDid } from "@/lib/import/numbers-csv";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  fileName: z.string().max(200).default("pasted CSV"),
  csv: z.string().min(1).max(2_000_000),
});

const AUTO_NOTE = "Seen on dialer, not imported";
const CHUNK = 500;

/**
 * Imports DIDs from CSV. The CSV is re-parsed here (never trusting the client preview):
 * new numbers are inserted as NEW with a lifecycle event; existing numbers get their details
 * updated but keep their lifecycle. Writes go through the admin's session, so RLS applies.
 */
export async function POST(request: Request) {
  const { admin, status } = await getAdminForApi();
  if (!admin) return Response.json({ error: status === 401 ? "Sign in again to import numbers." : "Admin access with MFA is required." }, { status });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send a CSV file to import." }, { status: 400 });

  const supabase = await createClient();
  const { data: existingRows, error: loadError } = await supabase.from("dids").select("id, e164, lifecycle, notes");
  if (loadError) return Response.json({ error: `Couldn’t load the current pool: ${loadError.message}` }, { status: 500 });

  const existing = (existingRows ?? []) as (ExistingDid & { id: string })[];
  const result = buildImport(parsed.data.csv, existing);
  if (result.error) return Response.json({ error: result.error }, { status: 422 });

  const byE164 = new Map(existing.map((d) => [d.e164, d]));
  const newRows = result.rows.filter((r) => r.status === "new");
  const updateRows = result.rows.filter((r) => r.status === "update");
  const source = `Imported from ${parsed.data.fileName}`;

  // Insert new numbers.
  const inserted: { id: string; e164: string }[] = [];
  for (let i = 0; i < newRows.length; i += CHUNK) {
    const chunk = newRows.slice(i, i + CHUNK).map((r) => ({
      e164: r.e164!,
      state: r.state,
      carrier: r.carrier,
      attestation: r.attestation,
      cnam: r.cnam,
      purchased_at: r.purchasedAt,
      mrc_cents: r.mrcCents,
      notes: r.notes,
    }));
    const { data, error } = await supabase.from("dids").insert(chunk).select("id, e164");
    if (error) {
      return Response.json(
        { error: `Import stopped after ${inserted.length} new numbers: ${error.message}`, inserted: inserted.length, updated: 0 },
        { status: 500 },
      );
    }
    inserted.push(...(data ?? []));
  }

  if (inserted.length) {
    const events = inserted.map((d) => ({ did_id: d.id, from_state: null, to_state: "NEW", reason: source, actor: admin.email }));
    for (let i = 0; i < events.length; i += CHUNK) {
      const { error } = await supabase.from("did_state_events").insert(events.slice(i, i + CHUNK));
      if (error) return Response.json({ error: `Numbers imported, but the lifecycle history failed: ${error.message}`, inserted: inserted.length, updated: 0 }, { status: 500 });
    }
  }

  // Update details of numbers already in the pool; lifecycle is never touched here.
  let updated = 0;
  for (const r of updateRows) {
    const current = byE164.get(r.e164!)!;
    const patch: Record<string, unknown> = { carrier: r.carrier };
    if (r.state) patch.state = r.state;
    if (r.attestation) patch.attestation = r.attestation;
    if (r.cnam) patch.cnam = r.cnam;
    if (r.purchasedAt) patch.purchased_at = r.purchasedAt;
    if (r.mrcCents !== null) patch.mrc_cents = r.mrcCents;
    if (r.notes) patch.notes = r.notes;
    else if (current.notes === AUTO_NOTE) patch.notes = null;

    const { error } = await supabase.from("dids").update(patch).eq("id", current.id);
    if (error) {
      return Response.json({ error: `Stopped while updating ${r.e164}: ${error.message}`, inserted: inserted.length, updated }, { status: 500 });
    }
    updated++;
  }

  return Response.json({ ...summarize(result.rows), inserted: inserted.length, updated });
}
