import Link from "next/link";
import { NotificationForm, type NotificationSettings } from "@/components/settings/notification-form";
import { settingsDrift } from "@udc/policy";
import { ApiCheckButton } from "@/components/settings/api-check";
import { DialingForm } from "@/components/settings/dialing-form";
import { ReputationGateForm } from "@/components/settings/reputation-gate-form";
import { Alert, DataTable, EmptyRow, PageHeader, Panel, StatusPill } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, isFresh, relative } from "@/lib/time";

const TABS = ["notifications", "health", "rotation", "dialing", "dialer", "admins"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { notifications: "Notifications", health: "Health checks", rotation: "Rotation", dialing: "Dialing", dialer: "Dialer sync", admins: "Admins" };

const HEARTBEAT_STALE_MS = 20 * 60_000;

type Policy = {
  agingDays: number;
  warmupDailyCaps: number[];
  activeDailyCap: number;
  hourlyCap: number;
  coolingDays: number;
  promote: { minAnswerRate: number; maxShortCallPct: number; maxDropPct: number };
  hardCool: { minAnswerRate3d: number; maxShortCallPct: number; maxDropPct: number; sip608Spike: number };
  softCool: { answerRateDropPts: number; shortCallPctFrom: number };
  retireIfLabeledAtDay: number;
  /** Absent on policies written before the gate became a setting; treated as on. */
  requireCleanReputation?: boolean;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await requireAdmin();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as Tab) : "notifications";

  const supabase = await createClient();
  const [settings, emails, policy, dialers, admins, scans, dialSettings, liveCampaign, commands] = await Promise.all([
    supabase.from("notification_settings").select("recipients, immediate_enabled, digest_enabled, digest_hour_et, last_run_at, last_error").maybeSingle(),
    supabase.from("notification_log").select("kind, status, subject, error, sent_at, recipients").order("sent_at", { ascending: false }).limit(10),
    supabase.from("policies").select("enforcement_mode, settings, updated_at, updated_by").eq("is_active", true).maybeSingle(),
    supabase.from("dialers").select("name, status, agent_version, last_heartbeat_at, created_at").order("name"),
    supabase.from("admins").select("email, created_at").order("created_at"),
    supabase.from("reputation_checks").select("did_id"),
    supabase.from("dial_settings").select("*").order("campaign_id").limit(1).maybeSingle(),
    supabase.from("campaigns_live").select("*").order("campaign_id").limit(1).maybeSingle(),
    supabase.from("commands").select("id, type, status, result, created_by, created_at, finished_at").order("created_at", { ascending: false }).limit(8),
  ]);

  const s = settings.data;
  const p = policy.data?.settings as Policy | undefined;
  const enforcing = policy.data?.enforcement_mode === "enforce";
  const scannedNumbers = new Set((scans.data ?? []).map((r) => r.did_id)).size;

  const d = dialSettings.data;
  const live = liveCampaign.data;
  // Which of the operator's choices VICIdial has not got, so the page never implies a plan is in force.
  const drift = d
    ? settingsDrift(
        {
          dialMethod: d.dial_method,
          linesPerAgent: Number(d.lines_per_agent),
          maxLinesPerAgent: Number(d.max_lines_per_agent),
          maxDropPct: Number(d.max_drop_pct),
          dialTimeoutSec: d.dial_timeout_sec,
          dropCallSeconds: d.drop_call_seconds,
          hopperLevel: d.hopper_level,
          availableOnlyTally: d.available_only_tally,
        },
        live
          ? {
              dialMethod: live.dial_method,
              linesPerAgent: Number(live.lines_per_agent),
              maxLinesPerAgent: Number(live.max_lines_per_agent),
              maxDropPct: Number(live.max_drop_pct),
              dialTimeoutSec: live.dial_timeout_sec,
              dropCallSeconds: live.drop_call_seconds,
              hopperLevel: live.hopper_level,
              availableOnlyTally: live.available_only_tally,
            }
          : null,
      )
    : [];

  return (
    <>
      <PageHeader title="Settings" description="Notification recipients, health-check thresholds, dialer sync and admin access." />

      <nav aria-label="Settings sections" className="-mb-3 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === "notifications" ? "/settings" : `/settings?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={`relative inline-flex min-h-11 shrink-0 items-center px-4 text-button ${
              tab === t ? "text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted hover:text-ink"
            }`}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      {tab === "notifications" && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Email notifications" subtitle="Who hears about problems, and how often." bodyClassName="px-6 pb-6">
            {s ? <NotificationForm settings={s as NotificationSettings} /> : <Alert>Couldn’t load notification settings.</Alert>}
          </Panel>

          <div className="flex flex-col gap-5">
            <Panel title="Delivery status" bodyClassName="flex flex-col gap-3 px-6 pb-6 text-caption">
              <div className="flex items-center gap-2">
                <StatusPill tone={s?.last_error ? "error" : "success"}>{s?.last_error ? "Not sending" : "Sending"}</StatusPill>
                <span className="text-muted">{s?.last_run_at ? `checked ${relative(s.last_run_at)}` : "not run yet"}</span>
              </div>
              {s?.last_error && <p className="rounded-md border border-error/20 bg-error/10 p-3 text-error">{s.last_error}</p>}
              <p className="text-muted">
                Emails are sent by the alerts-notify function in Supabase. The sender address and API key live in Edge Function secrets, not in this app.
              </p>
            </Panel>

            <Panel title="Recent emails" bodyClassName="flex flex-col gap-3 px-6 pb-6 text-caption">
              {(emails.data ?? []).length === 0 ? (
                <p className="text-muted">No emails sent yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {(emails.data ?? []).map((e, i) => (
                    <li key={`${e.sent_at}-${i}`} className="flex flex-col gap-0.5 border-b border-line pb-3 last:border-0 last:pb-0">
                      <span className="flex items-center gap-2">
                        <StatusPill tone={e.status === "sent" ? "success" : "error"}>{e.kind === "digest" ? "Summary" : "Alert"}</StatusPill>
                        <span className="text-muted">{formatDateTime(e.sent_at)}</span>
                      </span>
                      <span className="text-ink">{e.subject}</span>
                      {e.error && <span className="text-error">{e.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "health" && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          <Panel title="What triggers an alert" subtitle="Checked every 15 minutes against each number’s last 3 days." bodyClassName="px-6 pb-6">
            {p ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 text-caption">
                {(
                  [
                    ["Answer rate too low (critical)", `under ${pct(p.hardCool.minAnswerRate3d)}`],
                    ["Short calls too high (critical)", `over ${pct(p.hardCool.maxShortCallPct)} of answered`],
                    ["Short calls rising (warning)", `over ${pct(p.softCool.shortCallPctFrom)}`],
                    ["Drops too high (critical)", `over ${pct(p.hardCool.maxDropPct)}`],
                    ["Carrier 608 rejections (critical)", `${p.hardCool.sip608Spike} or more`],
                    ["Answer rate falling (warning)", `down ${Math.round(p.softCool.answerRateDropPts * 100)} points week over week`],
                    ["Spam label (critical)", "any label from a reputation scan"],
                    ["Dialer sync stopped (critical)", "no sync for 20 minutes"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-graphite">{k}</dt>
                    <dd className="text-right font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <Alert>Couldn’t load the health rules.</Alert>
            )}
          </Panel>

          <Panel title="Number lifecycle" subtitle="Caps and timings applied to every number." bodyClassName="px-6 pb-6">
            {p ? (
              <>
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 text-caption">
                  {(
                    [
                      ["Aging before first call", `${p.agingDays} days`],
                      ["Warm-up ramp", `${p.warmupDailyCaps.join(" → ")} calls a day`],
                      ["Active daily cap", `${p.activeDailyCap} calls`],
                      ["Hourly cap", `${p.hourlyCap} calls`],
                      ["Cool-off", `${p.coolingDays} days`],
                      ["Retire if still labeled", `after ${p.retireIfLabeledAtDay} days`],
                      ["Promote to Active", `answer rate ${pct(p.promote.minAnswerRate)}+, short calls under ${pct(p.promote.maxShortCallPct)}`],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-graphite">{k}</dt>
                      <dd className="text-right font-semibold text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-surface-alt p-4 text-caption">
                  <StatusPill tone={enforcing ? "success" : "warning"}>{enforcing ? "Enforcing" : "Dry run"}</StatusPill>
                  <span className="text-graphite">
                    {enforcing ? "Caps and lifecycle changes are applied on the dialer." : "Decisions are recorded only; nothing is sent to VICIdial yet."}
                  </span>
                  <span className="w-full text-legal text-muted">
                    Editing these values comes with the rotation engine (Phase 3). Last changed {policy.data?.updated_at ? relative(policy.data.updated_at) : "—"}
                    {policy.data?.updated_by ? ` by ${policy.data.updated_by}` : ""}.
                  </span>
                </div>
              </>
            ) : (
              <Alert>Couldn’t load the lifecycle settings.</Alert>
            )}
          </Panel>
        </div>
      )}

      {tab === "rotation" && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Reputation checks" subtitle="What the lifecycle engine needs before a number may start dialing." bodyClassName="px-6 pb-6">
            {p ? <ReputationGateForm required={p.requireCleanReputation !== false} scannedNumbers={scannedNumbers} /> : <Alert>Couldn’t load the rotation policy.</Alert>}
          </Panel>

          <Panel title="Where this applies" bodyClassName="flex flex-col gap-3 px-6 pb-6 text-caption text-graphite">
            <p>
              The gate is checked twice in a number’s life: when it leaves aging for warm-up, and when it comes back from a cool-off. Everything else — caps, warm-up steps,
              cooling on a bad answer rate — is unaffected.
            </p>
            <p>
              The engine itself is still in <strong className="text-ink">dry run</strong>: it records what it would do without changing the dialer. See <Link href="/rotation" className="text-ink hover:underline">Rotation</Link> for the decisions it is making.
            </p>
          </Panel>
        </div>
      )}

      {tab === "dialing" && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Predictive dialing" subtitle={d ? `Campaign ${d.campaign_id}` : undefined} bodyClassName="px-6 pb-6">
            {d ? (
              <DialingForm
                campaignId={d.campaign_id}
                settings={{
                  dialMethod: d.dial_method,
                  linesPerAgent: Number(d.lines_per_agent),
                  maxLinesPerAgent: Number(d.max_lines_per_agent),
                  maxDropPct: Number(d.max_drop_pct),
                  dialTimeoutSec: d.dial_timeout_sec,
                  dropCallSeconds: d.drop_call_seconds,
                  hopperLevel: d.hopper_level,
                  availableOnlyTally: d.available_only_tally,
                  plannedAgents: d.planned_agents,
                  reservedLines: d.reserved_lines,
                }}
                serverTrunks={live?.server_trunks ?? null}
                carrierChannels={d.carrier_channels}
              />
            ) : (
              <Alert>No campaign settings yet. They appear once the dialer agent has synced a campaign.</Alert>
            )}
          </Panel>

          <div className="flex flex-col gap-5">
            <Panel title="What the dialer is doing now" subtitle={live ? `Synced ${relative(live.synced_at)}` : undefined} bodyClassName="px-6 pb-6">
              {live ? (
                <>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 text-caption">
                    {(
                      [
                        ["Method", String(live.dial_method)],
                        ["Lines per agent", String(Number(live.lines_per_agent))],
                        ["Abandon limit", `${Number(live.max_drop_pct)}%`],
                        ["Ring time", `${live.dial_timeout_sec}s`],
                        ["Hopper", `${live.hopper_level} leads, ${live.leads_in_hopper} ready`],
                        ["Agents logged in", String(live.agents_logged_in ?? 0)],
                        ["Dialer trunk limit", live.server_trunks === null ? "unknown" : String(live.server_trunks)],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-graphite">{k}</dt>
                        <dd className="text-right font-semibold text-ink tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {drift.length > 0 && (
                    <p className="mt-4 rounded-md border border-warning/20 bg-warning/10 p-3 text-caption text-warning">
                      {drift.length} setting{drift.length === 1 ? "" : "s"} differ{drift.length === 1 ? "s" : ""} from your plan: {drift.map((x) => String(x.field)).join(", ")}. The dialer keeps its own values until a plan is applied there.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-caption text-muted">The agent has not synced a campaign yet.</p>
              )}
            </Panel>

            <Panel title="Applying a plan" bodyClassName="flex flex-col gap-3 px-6 pb-6 text-caption text-graphite">
              <p>Saving records what you want. Nothing reaches VICIdial: switching a live campaign to predictive changes how customers are called, so it stays a deliberate step.</p>
              <p>Moving from one line to two or three roughly doubles or triples the calls each number makes an hour, so raise it alongside the caller-ID pool, not ahead of it.</p>
            </Panel>
          </div>
        </div>
      )}

      {tab === "dialer" && (
        <div className="flex flex-col gap-5">
        <Panel title="Dialer sync" subtitle="The agent on the VICIdial server pushes agent states and per-number stats every 15 minutes." bodyClassName="px-2 pb-2">
          <DataTable head={["Dialer", "Status", "Last sync", "Agent version", "Connected since"]} minWidth={640} bare>
            {(dialers.data ?? []).length === 0 ? (
              <EmptyRow colSpan={5}>No dialer agent has connected yet.</EmptyRow>
            ) : (
              (dialers.data ?? []).map((d) => {
                const online = isFresh(d.last_heartbeat_at, HEARTBEAT_STALE_MS);
                return (
                  <tr key={d.name}>
                    <td className="font-semibold !text-ink">{d.name}</td>
                    <td>
                      <StatusPill tone={online ? "success" : "error"}>{online ? "Syncing" : d.status === "stopped" ? "Stopped" : "Offline"}</StatusPill>
                    </td>
                    <td>{relative(d.last_heartbeat_at)}</td>
                    <td className="tabular-nums">{d.agent_version ?? "—"}</td>
                    <td>{formatDateTime(d.created_at)}</td>
                  </tr>
                );
              })
            )}
          </DataTable>
        </Panel>

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Panel title="VICIdial API" subtitle="Used to add leads and change campaigns from here." bodyClassName="px-6 pb-6">
            <ApiCheckButton />
          </Panel>

          <Panel title="Recent commands" subtitle="Work sent to the dialer, newest first." bodyClassName="px-2 pb-2">
            <DataTable head={["Sent", "Command", "By", "Status", "Result"]} minWidth={620} bare>
              {(commands.data ?? []).length === 0 ? (
                <EmptyRow colSpan={5}>Nothing has been sent to the dialer yet.</EmptyRow>
              ) : (
                (commands.data ?? []).map((c) => {
                  const r = (c.result ?? {}) as { error?: string; version?: string; note?: string };
                  return (
                    <tr key={c.id}>
                      <td className="tabular-nums">{formatDateTime(c.created_at)}</td>
                      <td className="font-semibold !text-ink">{c.type}</td>
                      <td>{c.created_by}</td>
                      <td>
                        <StatusPill tone={c.status === "done" ? "success" : c.status === "failed" ? "error" : "warning"}>{c.status}</StatusPill>
                      </td>
                      <td className="max-w-[360px] truncate" title={r.error ?? r.version ?? r.note ?? ""}>
                        {r.error ?? r.version ?? r.note ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </DataTable>
          </Panel>
        </div>
        </div>
      )}

      {tab === "admins" && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Admins" subtitle="Everyone who can sign in to this app." bodyClassName="px-2 pb-2">
            <DataTable head={["Email", "Added"]} minWidth={420} bare>
              {(admins.data ?? []).length === 0 ? (
                <EmptyRow colSpan={2}>No admins found.</EmptyRow>
              ) : (
                (admins.data ?? []).map((a) => (
                  <tr key={a.email}>
                    <td className="font-semibold !text-ink">{a.email}</td>
                    <td>{formatDateTime(a.created_at)}</td>
                  </tr>
                ))
              )}
            </DataTable>
          </Panel>
          <Panel title="Adding an admin" bodyClassName="flex flex-col gap-3 px-6 pb-6 text-caption text-graphite">
            <p>Access is deliberately manual, so nobody can sign themselves up:</p>
            <ol className="flex list-decimal flex-col gap-2 pl-4">
              <li>Create the user in Supabase → Authentication → Users, with Auto Confirm on.</li>
              <li>Add their user id and email to the <code className="font-mono text-code text-ink">admins</code> table.</li>
              <li>They sign in and set up an authenticator app; every session needs a code.</li>
            </ol>
          </Panel>
        </div>
      )}
    </>
  );
}
