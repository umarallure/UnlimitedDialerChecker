import Link from "next/link";
import { AgentFrame } from "@/components/dialer/agent-frame";
import { requireAgent } from "@/lib/dal";

/**
 * The agent's shell.
 *
 * The VICIdial frame is mounted **here**, in the layout, not on the page. It is the engine: it
 * holds the agent's session, receives predictive calls and runs the webphone. If a route change
 * unmounted it, the agent would silently drop out of the dialing queue mid-shift and calls would
 * stop arriving with nothing on screen to say why.
 */
export default async function AgentLayout({ children }: LayoutProps<"/">) {
  const agent = await requireAgent();

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-title-sm font-bold text-ink">Dialer</span>
          <span className="text-caption text-muted">
            {agent.agentUser}
            {agent.campaignId ? ` · ${agent.campaignId}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-caption text-muted">{agent.email}</span>
          <Link
            href="/auth/signout"
            prefetch={false}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-button text-ink hover:border-line-strong"
          >
            Sign out
          </Link>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">{children}</main>

      <AgentFrame />
    </div>
  );
}
