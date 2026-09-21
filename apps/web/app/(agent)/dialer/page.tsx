import { CallBar, type Disposition } from "@/components/dialer/call-bar";
import { requireAgent } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * What an agent sees when they sign in.
 *
 * The outcomes offered are the ones their own campaign actually has, read from the dialer rather
 * than listed here — a campaign's dispositions can change at any time, and a button that sends a
 * status the campaign does not have fails at the worst possible moment.
 */
export default async function DialerPage() {
  const agent = await requireAgent();
  const supabase = await createClient();

  const { data } = await supabase
    .from("dialer_campaign_statuses")
    .select("campaign_id, status, status_name, selectable, sale, dnc, not_interested, scheduled_callback")
    .eq("selectable", true);

  // The campaign's own wording wins over the shared system status of the same code.
  const rows = (data ?? []) as {
    campaign_id: string;
    status: string;
    status_name: string | null;
    sale: boolean;
    dnc: boolean;
    scheduled_callback: boolean;
  }[];

  const dispositions: Disposition[] = [...rows]
    .sort((a, b) => Number(b.campaign_id === agent.campaignId) - Number(a.campaign_id === agent.campaignId))
    .filter((row, i, list) => list.findIndex((x) => x.status === row.status) === i)
    .map((row) => ({
      status: row.status,
      name: row.status_name?.trim() || row.status,
      sale: row.sale,
      dnc: row.dnc,
      callback: row.scheduled_callback,
    }))
    // Sale first, then callbacks, then the rest: the order an agent reaches for them.
    .sort((a, b) => Number(b.sale) - Number(a.sale) || Number(b.callback) - Number(a.callback) || a.name.localeCompare(b.name));

  return <CallBar dispositions={dispositions} />;
}
