import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export default async function NumbersPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: dids, error } = await supabase
    .from("dids")
    .select("id, e164, state, area_code, lifecycle, daily_cap, manual_hold, attestation, did_stats_live(calls_today, answered_today, short_calls_today)")
    .order("state")
    .order("e164");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Numbers</h1>
        <p className="text-sm text-zinc-500">CSV import, health scoring and reputation scans arrive in Phase 2.</p>
      </div>
      {error && <p className="text-sm text-red-600">Couldn’t load numbers: {error.message}</p>}
      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Lifecycle</th>
              <th className="px-3 py-2">Calls today / cap</th>
              <th className="px-3 py-2">Answered</th>
              <th className="px-3 py-2">Attestation</th>
            </tr>
          </thead>
          <tbody>
            {(dids ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No numbers yet. Teleinx DIDs will be imported here.
                </td>
              </tr>
            ) : (
              (dids ?? []).map((d) => {
                const live = Array.isArray(d.did_stats_live) ? d.did_stats_live[0] : d.did_stats_live;
                return (
                  <tr key={d.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-3 py-2 font-mono">{d.e164}</td>
                    <td className="px-3 py-2">{d.state ?? "—"}</td>
                    <td className="px-3 py-2">
                      {d.lifecycle}
                      {d.manual_hold ? " · held" : ""}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {live?.calls_today ?? 0} / {d.daily_cap}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{live?.answered_today ?? 0}</td>
                    <td className="px-3 py-2">{d.attestation ?? "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
