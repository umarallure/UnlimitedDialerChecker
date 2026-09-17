import { requireAdmin } from "@/lib/dal";
import { AgentsBoard } from "./agents-board";

export default async function AgentsPage() {
  await requireAdmin();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-zinc-500">Live from VICIdial once the dialer agent is running (Phase 1).</p>
      </div>
      <AgentsBoard />
    </div>
  );
}
