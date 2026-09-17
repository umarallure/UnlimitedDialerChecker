import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { AnnouncementBar, TopBar } from "@/components/shell/top-bar";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { isFresh, relative } from "@/lib/time";

const HEARTBEAT_STALE_MS = 2 * 60_000;

export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const [alerts, dialers, policy] = await Promise.all([
    supabase.from("alerts").select("id", { count: "exact", head: true }).is("resolved_at", null),
    supabase.from("dialers").select("name, last_heartbeat_at").order("last_heartbeat_at", { ascending: false }).limit(1),
    supabase.from("policies").select("enforcement_mode").eq("is_active", true).maybeSingle(),
  ]);

  const dialer = dialers.data?.[0];
  const online = isFresh(dialer?.last_heartbeat_at, HEARTBEAT_STALE_MS);
  const mode = policy.data?.enforcement_mode === "enforce" ? "Rotation enforcing" : "Rotation in dry run, no changes sent to VICIdial";

  return (
    <div className="flex h-dvh flex-col">
      <AnnouncementBar
        tone={online ? "ok" : "warn"}
        message={
          dialer
            ? online
              ? `Dialer ${dialer.name} syncing · last update ${relative(dialer.last_heartbeat_at)}`
              : `Dialer ${dialer.name} offline · last update ${relative(dialer.last_heartbeat_at)}`
            : "Dialer agent not connected yet"
        }
        detail={mode}
      />
      <TopBar email={admin.email} openAlerts={alerts.count ?? 0} />
      <MobileNav />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          <div className="flex w-full flex-col gap-8 px-6 py-8 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
