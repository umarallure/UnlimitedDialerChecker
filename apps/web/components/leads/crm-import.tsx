"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Plug, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type AgentTarget, CrmImportDialog } from "./crm-import-dialog";

export type Connection = {
  id: string;
  name: string;
  source_schema: string;
  source_table: string | null;
  status: string;
  last_error: string | null;
  last_import_at: string | null;
};

const control = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";

/**
 * The CRM panel: connect once, then a single button that opens the import.
 *
 * Choosing the table, the unique column and the field mapping used to live here, but they are
 * the same every time for a given CRM, so the dialog works them out instead.
 */
export function CrmImport({ connection, agents }: { connection: Connection | null; agents: AgentTarget[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [connectionString, setConnectionString] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);

  async function connect() {
    setConnecting(true);
    const res = await fetch("/api/crm/connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, connectionString, schema: "public" }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setConnecting(false);

    if (!res?.ok) {
      toast.error("Could not connect", { description: body.error ?? "Check the connection string." });
      return;
    }
    setConnectionString("");
    toast.success("Connected", { description: `${body.tables.length} readable table${body.tables.length === 1 ? "" : "s"}.` });
    router.refresh();
  }

  async function disconnect() {
    if (!connection) return;
    const res = await fetch(`/api/crm/connection?id=${connection.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      toast.error("Could not disconnect");
      return;
    }
    toast.success("Connection forgotten", { description: "The credential is deleted here. Drop the read-only role in your CRM to finish." });
    router.refresh();
  }

  if (!connection) {
    return (
      <div className="flex max-w-[640px] flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-lg bg-surface-alt p-4 text-caption text-graphite">
          <p className="font-semibold text-ink">First, make a read-only user in your CRM project</p>
          <p>Run this in that project’s SQL editor, changing the table name and password:</p>
          <pre className="overflow-x-auto rounded-md bg-surface p-3 text-code text-ink">{`create role udc_reader login password 'a-long-random-password';
grant connect on database postgres to udc_reader;
grant usage on schema public to udc_reader;
grant select on public.leads to udc_reader;`}</pre>
          <p>
            Then take that project’s <strong className="text-ink">pooler</strong> connection string, swap the username for{" "}
            <code className="text-ink">udc_reader.&lt;project-ref&gt;</code> with its password, and paste it below. To cut access off later, disconnect here and run{" "}
            <code className="text-ink">drop role udc_reader;</code> there.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Name</span>
          <input className={control} value={name} onChange={(e) => setName(e.target.value)} placeholder="Power Policies CRM" autoComplete="off" name="crm-label" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Connection string</span>
          <input
            className={`${control} font-mono`}
            type="password"
            autoComplete="new-password"
            name="crm-connection"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            placeholder="postgresql://udc_reader.abcdef:…@aws-0-region.pooler.supabase.com:5432/postgres"
          />
          <span className="text-legal text-muted">Stored encrypted and never shown again. It is tested before it is saved.</span>
        </label>

        <button
          type="button"
          onClick={connect}
          disabled={connecting || !name || connectionString.length < 20}
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover disabled:opacity-60"
        >
          <Plug aria-hidden className="size-4" />
          {connecting ? "Testing…" : "Connect"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-caption">
        <Database aria-hidden className="size-4 text-muted" />
        <strong className="text-ink">{connection.name}</strong>
        <span className="text-muted">schema {connection.source_schema}</span>
        {connection.last_error && <span className="text-error">{connection.last_error}</span>}
      </span>

      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary shadow-sm hover:bg-primary-hover"
        >
          Import leads
        </button>
        <button type="button" onClick={disconnect} className="inline-flex min-h-11 items-center gap-2 px-3 text-button text-muted hover:text-error">
          <Trash2 aria-hidden className="size-4" /> Disconnect
        </button>
      </span>

      <CrmImportDialog
        connectionId={connection.id}
        rememberedTable={connection.source_table}
        agents={agents}
        open={importing}
        onClose={() => setImporting(false)}
      />
    </div>
  );
}
