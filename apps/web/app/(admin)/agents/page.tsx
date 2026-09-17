import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { AgentsBoard } from "./agents-board";

export default async function AgentsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Agents"
        description="Live VICIdial agent states. Updates in real time once the dialer agent is running (Phase 1)."
      />
      <AgentsBoard />
    </>
  );
}
