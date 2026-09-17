import { Alert, DataTable, EmptyRow, PageHeader, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { LIFECYCLE_TONE } from "@/lib/status";
import { createClient } from "@/lib/supabase/server";

function formatE164(e164: string) {
  const d = e164.replace(/^\+1/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

export default async function NumbersPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: dids, error } = await supabase
    .from("dids")
    .select("id, e164, state, area_code, lifecycle, daily_cap, manual_hold, attestation, did_stats_live(calls_today, answered_today, short_calls_today)")
    .order("state")
    .order("e164");

  const rows = dids ?? [];

  return (
    <>
      <PageHeader
        title="Numbers"
        description="Every caller-ID DID in the pool with today’s usage against its cap. CSV import, health scoring and reputation scans arrive in Phase 2."
      />
      {error && <Alert>Couldn’t load numbers: {error.message}</Alert>}
      <DataTable head={["Number", "State", "Lifecycle", "Calls today / cap", "Answered", "Attestation"]} minWidth={720}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6}>No numbers yet. Teleinx DIDs will be imported here.</EmptyRow>
        ) : (
          rows.map((d) => {
            const live = Array.isArray(d.did_stats_live) ? d.did_stats_live[0] : d.did_stats_live;
            const calls = live?.calls_today ?? 0;
            const usage = d.daily_cap > 0 ? Math.min(calls / d.daily_cap, 1) : 0;
            return (
              <tr key={d.id} className="hover:bg-surface-alt">
                <td className="font-mono text-code !text-ink">{formatE164(d.e164)}</td>
                <td>{d.state ?? "—"}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    <StatusPill tone={LIFECYCLE_TONE[d.lifecycle] ?? "neutral"}>{d.lifecycle}</StatusPill>
                    {d.manual_hold && <StatusPill tone="error">Held</StatusPill>}
                  </span>
                </td>
                <td>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">
                      {calls} / {d.daily_cap}
                    </span>
                    <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                      <span
                        className={`block h-full rounded-full ${usage >= 1 ? "bg-error" : usage >= 0.8 ? "bg-warning" : "bg-success"}`}
                        style={{ width: `${usage * 100}%` }}
                      />
                    </span>
                  </span>
                </td>
                <td className="tabular-nums">{live?.answered_today ?? 0}</td>
                <td>
                  {d.attestation ? (
                    <StatusPill tone={d.attestation === "A" ? "success" : "error"}>{d.attestation}</StatusPill>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            );
          })
        )}
      </DataTable>
    </>
  );
}
