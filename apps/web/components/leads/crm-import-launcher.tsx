"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { type AgentTarget, CrmImportDialog } from "./crm-import-dialog";

/** Opens the guided CRM import once a connection has a table chosen. */
export function CrmImportLauncher({
  connectionId,
  table,
  agents,
}: {
  connectionId: string;
  table: string;
  agents: AgentTarget[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary shadow-sm hover:bg-primary-hover"
      >
        <Download aria-hidden className="size-4" />
        Import leads
      </button>
      <CrmImportDialog connectionId={connectionId} table={table} agents={agents} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
