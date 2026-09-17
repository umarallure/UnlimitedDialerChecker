import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";
import { AgentsBoard } from "./agents-board";

export default async function AgentsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Agents" description="Live VICIdial agent states, updated every few seconds from the dialer." />
      <AgentsBoard />
    </>
  );
}
