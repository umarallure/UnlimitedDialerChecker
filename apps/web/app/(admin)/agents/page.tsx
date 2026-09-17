import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { AgentsBoard } from "./agents-board";

export default async function AgentsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Agents" description="VICIdial agent states, synced from the dialer every 15 minutes." />
      <AgentsBoard />
    </>
  );
}
