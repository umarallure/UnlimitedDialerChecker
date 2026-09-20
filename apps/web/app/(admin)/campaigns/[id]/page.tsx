import Link from "next/link";
import { notFound } from "next/navigation";
import { Headset, ListChecks, PhoneOutgoing, ShieldAlert } from "lucide-react";
import { TSR_ABANDON_CAP_PCT, abandonRate, complianceLevel } from "@udc/policy";
import { LeadTable } from "@/components/campaigns/lead-table";
import { Alert, DataTable, EmptyRow, KpiCard, PageHeader, Pagination, Panel } from "@/components/ui";
import { agentTargets, campaignsOf } from "@/lib/agent-targets";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { dialerDay } from "@/lib/time";

const PAGE_SIZE = 50;

/** Statuses a campaign will dial, from its `dial_statuses` (space-delimited, '-' as padding). */
function dialableFrom(dialStatuses: string | null | undefined): string[] {
  return (dialStatuses ?? "")
    .trim()
    .split(/\s+/)
    .filter((s) => s && s !== "-");
}

export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const owner = typeof sp.owner === "string" ? sp.owner : "";
  const status = typeof sp.status === "string" ? sp.status : "";

  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns_live").select("*").eq("campaign_id", id).maybeSingle();
  if (!campaign) notFound();

  let leadQuery = supabase
    .from("dialer_leads")
    .select("lead_id, owner, status, first_name, last_name, state, phone_last4, called_count, last_call_at, entry_date", { count: "exact" })
    .eq("campaign_id", id)
    .order("lead_id", { ascending: false });
  if (owner) leadQuery = leadQuery.eq("owner", owner);
  if (status) leadQuery = leadQuery.eq("status", status);

  const from = (page - 1) * PAGE_SIZE;
  const [{ data: leads, count }, { data: everything }, { data: users }, { data: groups }, { data: lists }, { data: today }] = await Promise.all([
    leadQuery.range(from, from + PAGE_SIZE - 1),
    supabase.from("dialer_leads").select("owner, status").eq("campaign_id", id),
    supabase.from("dialer_users").select("user_name, full_name, user_level, user_group, active").eq("active", true).lte("user_level", 7),
    supabase.from("dialer_user_groups").select("user_group, allowed_campaigns"),
    supabase.from("dialer_lists").select("list_id, list_name, campaign_id, active, leads"),
    supabase.from("campaign_stats_daily").select("*").eq("campaign_id", id).eq("day", dialerDay()).maybeSingle(),
  ]);

  const all = everything ?? [];
  const dialable = dialableFrom(campaign.dial_statuses as string | null);
  const waiting = all.filter((l) => l.status && dialable.includes(l.status)).length;

  // Who may work this campaign, and what each of them has waiting.
  const targets = agentTargets(users ?? [], groups ?? [], lists ?? []);
  const onCampaign = (users ?? []).filter((u) => campaignsOf((groups ?? []).find((g) => g.user_group === u.user_group)?.allowed_campaigns).includes(id));

  const byOwner = new Map<string, { total: number; waiting: number }>();
  for (const l of all) {
    const key = l.owner ?? "";
    const current = byOwner.get(key) ?? { total: 0, waiting: 0 };
    current.total++;
    if (l.status && dialable.includes(l.status)) current.waiting++;
    byOwner.set(key, current);
  }

  const statuses = [...new Set(all.map((l) => l.status).filter((s): s is string => Boolean(s)))].sort();
  const rate = today ? abandonRate(today) : null;
  const level = complianceLevel(rate);
  const href = (next: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const merged = { owner, status, page, ...next };
    for (const [k, v] of Object.entries(merged)) if (v && v !== 1) q.set(k, String(v));
    const s = q.toString();
    return s ? `/campaigns/${id}?${s}` : `/campaigns/${id}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/campaigns">← All campaigns</Link>}
        title={(campaign.campaign_id as string) ?? id}
        description={`${campaign.dial_method === "MANUAL" ? "One call at a time" : `${Number(campaign.lines_per_agent)} lines per agent`} · caller ID from the pool · ${
          campaign.active ? "active" : "not active"
        }`}
        action={
          <Link
            href="/leads/import"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary shadow-sm hover:bg-primary-hover"
          >
            Add leads
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Leads" value={all.length.toLocaleString()} note={`${waiting.toLocaleString()} still to dial`} icon={<ListChecks className="size-5" strokeWidth={1.75} />} />
        <KpiCard label="Agents" value={onCampaign.length} note={`${campaign.agents_logged_in ?? 0} logged in now`} icon={<Headset className="size-5" strokeWidth={1.75} />} />
        <KpiCard
          label="Calls today"
          value={(today?.calls ?? 0).toLocaleString()}
          note={today ? `${today.connected} reached an agent` : "None yet"}
          icon={<PhoneOutgoing className="size-5" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Abandoned"
          value={rate === null ? "—" : `${Math.round(rate * 10) / 10}%`}
          note={rate === null ? "Nobody has answered yet" : `Limit ${TSR_ABANDON_CAP_PCT}%`}
          noteTone={level === "over" ? "error" : level === "at_risk" ? "warning" : "muted"}
          icon={<ShieldAlert className="size-5" strokeWidth={1.75} />}
        />
      </div>

      {waiting === 0 && all.length > 0 && (
        <Alert tone="warning">
          Every lead here has been called. Select the ones worth another try and choose <strong>Dial again</strong>, or add more from the Leads page.
        </Alert>
      )}

      <Panel title="Agents on this campaign" subtitle="What each of them has left to dial." bodyClassName="px-2 pb-2">
        <DataTable head={["Agent", "Leads", "Still to dial", "Their list"]} minWidth={560} bare>
          {onCampaign.length === 0 ? (
            <EmptyRow colSpan={4}>Nobody is assigned to this campaign.</EmptyRow>
          ) : (
            onCampaign.map((u) => {
              const counts = byOwner.get(u.user_name) ?? { total: 0, waiting: 0 };
              const target = targets.find((t) => t.user_name === u.user_name);
              return (
                <tr key={u.user_name}>
                  <td className="font-semibold !text-ink">{u.full_name || u.user_name}</td>
                  <td className="tabular-nums">{counts.total.toLocaleString()}</td>
                  <td className="tabular-nums">
                    {counts.waiting > 0 ? counts.waiting.toLocaleString() : <span className="text-warning">nothing left</span>}
                  </td>
                  <td className="tabular-nums">{target?.listId ?? <span className="text-muted">none</span>}</td>
                </tr>
              );
            })
          )}
        </DataTable>
      </Panel>

      <Panel
        title="Leads"
        subtitle={`${(count ?? 0).toLocaleString()} matching${owner || status ? " these filters" : ""}. Taking leads out moves them to the parked list — nothing is deleted.`}
        bodyClassName="p-0"
        action={
          <form action={`/campaigns/${id}`} method="get" className="flex flex-wrap items-center gap-2">
            <select name="owner" defaultValue={owner} className="h-11 rounded-md border border-line bg-surface px-3 text-caption text-ink">
              <option value="">Every agent</option>
              {[...byOwner.keys()].filter(Boolean).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={status} className="h-11 rounded-md border border-line bg-surface px-3 text-caption text-ink">
              <option value="">Any status</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong">Apply</button>
          </form>
        }
      >
        <LeadTable leads={leads ?? []} agents={targets} dialableStatuses={dialable} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} unit="leads" hrefFor={(p) => href({ page: p })} />
      </Panel>
    </>
  );
}
