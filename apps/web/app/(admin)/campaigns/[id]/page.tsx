import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadTable } from "@/components/campaigns/lead-table";
import { CampaignPerformance } from "@/components/campaigns/performance";
import { StatsFilterBar } from "@/components/campaigns/stats-filters";
import { Alert, LoadingKpis, LoadingPanel, PageHeader, Pagination, Panel } from "@/components/ui";
import { agentTargets, campaignsOf } from "@/lib/agent-targets";
import { parseStatsFilters, statsHref, type StatsFilters } from "@/lib/campaign-stats";
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

/**
 * The leads themselves: who owns what, and what is left to dial.
 *
 * Kept behind its own boundary because it pages through thousands of rows while the figures
 * above it are being added up. Neither waits for the other.
 */
async function LeadsSection({
  campaignId,
  dialable,
  page,
  owner,
  status,
  hrefFor,
}: {
  campaignId: string;
  dialable: string[];
  page: number;
  owner: string;
  status: string;
  hrefFor: (next: Record<string, string | number | undefined>) => string;
}) {
  const supabase = await createClient();

  let leadQuery = supabase
    .from("dialer_leads")
    .select("lead_id, owner, status, first_name, last_name, state, phone_last4, called_count, last_call_at, entry_date", { count: "exact" })
    .eq("campaign_id", campaignId)
    .order("lead_id", { ascending: false });
  if (owner) leadQuery = leadQuery.eq("owner", owner);
  if (status) leadQuery = leadQuery.eq("status", status);

  const from = (page - 1) * PAGE_SIZE;
  const [{ data: leads, count }, { data: everything }, { data: users }, { data: groups }, { data: lists }] = await Promise.all([
    leadQuery.range(from, from + PAGE_SIZE - 1),
    supabase.from("dialer_leads").select("owner, status").eq("campaign_id", campaignId),
    supabase.from("dialer_users").select("user_name, full_name, user_level, user_group, active").eq("active", true).lte("user_level", 7),
    supabase.from("dialer_user_groups").select("user_group, allowed_campaigns"),
    supabase.from("dialer_lists").select("list_id, list_name, campaign_id, active, leads"),
  ]);

  const all = everything ?? [];
  const waiting = all.filter((l) => l.status && dialable.includes(l.status)).length;
  const targets = agentTargets(users ?? [], groups ?? [], lists ?? []);
  const owners = [...new Set(all.map((l) => l.owner).filter((o): o is string => Boolean(o)))].sort();
  const statuses = [...new Set(all.map((l) => l.status).filter((s): s is string => Boolean(s)))].sort();

  return (
    <>
      {waiting === 0 && all.length > 0 && (
        <Alert tone="warning">
          Every lead here has been called. Select the ones worth another try and choose <strong>Dial again</strong>, or add more from the Leads page.
        </Alert>
      )}

      <Panel
        title="Leads"
        subtitle={`${(count ?? 0).toLocaleString()} matching${owner || status ? " these filters" : ""} of ${all.length.toLocaleString()} in the campaign, ${waiting.toLocaleString()} still to dial. Taking leads out moves them to the parked list — nothing is deleted.`}
        bodyClassName="p-0"
        action={
          <form action={`/campaigns/${campaignId}`} method="get" className="flex flex-wrap items-center gap-2">
            <select name="owner" defaultValue={owner} className="h-11 rounded-md border border-line bg-surface px-3 text-caption text-ink">
              <option value="">Every agent</option>
              {owners.map((o) => (
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
        <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} unit="leads" hrefFor={(p) => hrefFor({ page: p })} />
      </Panel>
    </>
  );
}

export default async function CampaignPage({ params, searchParams }: PageProps<"/campaigns/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const owner = typeof sp.owner === "string" ? sp.owner : "";
  const status = typeof sp.status === "string" ? sp.status : "";

  const today = dialerDay();
  const filters: StatsFilters = parseStatsFilters(sp, today);

  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns_live").select("*").eq("campaign_id", id).maybeSingle();
  if (!campaign) notFound();

  const { data: users } = await supabase.from("dialer_users").select("user_name, user_group, active").eq("active", true);
  const { data: groups } = await supabase.from("dialer_user_groups").select("user_group, allowed_campaigns");
  const onCampaign = (users ?? [])
    .filter((u) => campaignsOf((groups ?? []).find((g) => g.user_group === u.user_group)?.allowed_campaigns).includes(id))
    .map((u) => u.user_name);

  const dialable = dialableFrom(campaign.dial_statuses as string | null);

  // Changing the window must re-suspend the figures, so the key carries the window itself.
  const statsKey = statsHref(id, filters);
  const href = (next: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams(statsKey.split("?")[1] ?? "");
    for (const [k, v] of Object.entries({ owner, status, page, ...next })) {
      if (v && v !== 1) q.set(k, String(v));
      else q.delete(k);
    }
    return `/campaigns/${id}?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/campaigns">← All campaigns</Link>}
        title={(campaign.campaign_id as string) ?? id}
        description={`${campaign.dial_method === "MANUAL" ? "One call at a time" : `${Number(campaign.lines_per_agent)} lines per agent`} · caller ID from the pool · ${
          campaign.active ? "active" : "not active"
        } · ${Number(campaign.agents_logged_in ?? 0)} agent${Number(campaign.agents_logged_in ?? 0) === 1 ? "" : "s"} logged in now`}
        action={
          <Link
            href="/leads/import"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary shadow-sm hover:bg-primary-hover"
          >
            Add leads
          </Link>
        }
      />

      <StatsFilterBar campaignId={id} filters={filters} today={today} agents={onCampaign} />

      <Suspense key={statsKey} fallback={<PerformanceSkeleton />}>
        <CampaignPerformance campaignId={id} filters={filters} dialable={dialable} />
      </Suspense>

      <Suspense key={`leads:${owner}:${status}:${page}`} fallback={<LoadingPanel title="Leads" lines={6} />}>
        <LeadsSection campaignId={id} dialable={dialable} page={page} owner={owner} status={status} hrefFor={href} />
      </Suspense>
    </>
  );
}

function PerformanceSkeleton() {
  return (
    <>
      <LoadingKpis />
      <LoadingPanel title="The rest of the picture" lines={2} />
      <LoadingPanel title="Outcomes" lines={4} />
      <LoadingPanel title="Agents" lines={3} />
    </>
  );
}

