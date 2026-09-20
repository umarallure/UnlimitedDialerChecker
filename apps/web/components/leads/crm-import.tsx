"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Plug, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { FILTER_OPERATORS, type FilterOperator } from "@/lib/crm/query";
import { FIELD_LABEL, LEAD_FIELDS, type LeadField } from "@/lib/import/leads-csv";
import type { AgentOption, ListOption } from "./import-form";

export type Connection = {
  id: string;
  name: string;
  source_schema: string;
  source_table: string | null;
  column_map: Record<string, string>;
  filters: Filter[];
  status: string;
  last_error: string | null;
  last_import_at: string | null;
};

type Filter = { column: string; operator: FilterOperator; value?: string };
type Column = { name: string; type: string };
type PreviewRow = { sourceId: string; phone: string | null; values: Record<string, string | null> };

const control = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";

/** Connect a CRM database, choose what to read, and send it to a campaign. */
export function CrmImport({ connection, lists, agents }: { connection: Connection | null; lists: ListOption[]; agents: AgentOption[] }) {
  const router = useRouter();

  // Connection form
  const [name, setName] = useState("");
  const [connectionString, setConnectionString] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Source selection
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState(connection?.source_table ?? "");
  const [columns, setColumns] = useState<Column[]>([]);
  const [sourceIdColumn, setSourceIdColumn] = useState("");
  const [columnMap, setColumnMap] = useState<Record<string, string>>(connection?.column_map ?? {});
  const [filters, setFilters] = useState<Filter[]>(connection?.filters ?? []);
  const [skipImported, setSkipImported] = useState(true);

  // Destination
  const [listId, setListId] = useState<number | "">(lists.find((l) => l.active)?.list_id ?? "");
  const [owner, setOwner] = useState("");
  const [limit, setLimit] = useState(500);

  const [preview, setPreview] = useState<{ rows: PreviewRow[]; unusable: number; excluded: number } | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);

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
    toast.success("Connection forgotten", { description: "The credential has been deleted here. Drop the read-only role in your CRM to finish." });
    router.refresh();
  }

  async function loadSchema(forTable?: string) {
    if (!connection) return;
    const url = `/api/crm/schema?id=${connection.id}${forTable ? `&table=${encodeURIComponent(forTable)}` : ""}`;
    const res = await fetch(url).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      toast.error("Could not read that database", { description: body.error });
      return;
    }
    setTables(body.tables ?? []);
    if (forTable) {
      setColumns(body.columns ?? []);
      const names: string[] = (body.columns ?? []).map((c: Column) => c.name);
      if (!sourceIdColumn) setSourceIdColumn(names.includes("id") ? "id" : (names[0] ?? ""));
      if (Object.keys(columnMap).length === 0) {
        const guess: Record<string, string> = {};
        for (const field of LEAD_FIELDS) {
          const hit = names.find((n) => n.toLowerCase().replace(/[^a-z]/g, "") === field.toLowerCase());
          if (hit) guess[field] = hit;
        }
        const phone = names.find((n) => /phone|mobile|cell/i.test(n));
        if (phone && !guess.phoneNumber) guess.phoneNumber = phone;
        setColumnMap(guess);
      }
    }
  }

  async function runPreview() {
    if (!connection || !table) return;
    setBusy("preview");
    const res = await fetch("/api/crm/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: connection.id, table, columnMap, sourceIdColumn, filters, skipImported, limit: 25 }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) {
      toast.error("Preview failed", { description: body.error });
      return;
    }
    setPreview(body);
  }

  async function runImport() {
    if (!connection || !table || listId === "") return;
    setBusy("import");
    const res = await fetch("/api/crm/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: connection.id, table, columnMap, sourceIdColumn, filters, skipImported, limit, listId, owner: owner || undefined }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) {
      toast.error("Import failed", { description: body.error });
      return;
    }
    toast.success(`${body.total} lead${body.total === 1 ? "" : "s"} queued`, {
      description: `${body.commands} batch${body.commands === 1 ? "" : "es"} sent to the dialer${body.unusable ? `. ${body.unusable} row(s) had no usable phone number.` : "."}`,
    });
    setPreview(null);
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
            Then take that project’s <strong className="text-ink">pooler</strong> connection string, swap in <code className="text-ink">udc_reader</code> and its password, and
            paste it below. To cut access off later, disconnect here and run <code className="text-ink">drop role udc_reader;</code> there.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Name</span>
          <input className={control} value={name} onChange={(e) => setName(e.target.value)} placeholder="Power Policies CRM" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Connection string</span>
          <input
            className={`${control} font-mono`}
            type="password"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            placeholder="postgresql://udc_reader:…@aws-0-region.pooler.supabase.com:6543/postgres"
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-alt p-4">
        <span className="flex items-center gap-2 text-caption">
          <Database aria-hidden className="size-4 text-muted" />
          <strong className="text-ink">{connection.name}</strong>
          <span className="text-muted">schema {connection.source_schema}</span>
          {connection.last_error && <span className="text-error">{connection.last_error}</span>}
        </span>
        <button type="button" onClick={disconnect} className="inline-flex min-h-11 items-center gap-2 px-3 text-button text-error hover:underline">
          <Trash2 aria-hidden className="size-4" /> Disconnect
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Table</span>
          <select
            className={control}
            value={table}
            onFocus={() => tables.length === 0 && loadSchema()}
            onChange={(e) => {
              setTable(e.target.value);
              setColumns([]);
              setPreview(null);
              loadSchema(e.target.value);
            }}
          >
            <option value="">{tables.length ? "Choose a table" : "Click to load tables"}</option>
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-graphite">Unique column</span>
          <select className={control} value={sourceIdColumn} onChange={(e) => setSourceIdColumn(e.target.value)} disabled={columns.length === 0}>
            <option value="">Choose a column</option>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-legal text-muted">Used to remember which rows have already been taken.</span>
        </label>
      </div>

      {columns.length > 0 && (
        <>
          <div className="flex flex-col gap-3">
            <h3 className="text-title-sm font-semibold text-ink">Match columns</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LEAD_FIELDS.map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-caption text-graphite">
                    {FIELD_LABEL[field as LeadField]}
                    {field === "phoneNumber" && <span className="text-error"> *</span>}
                  </span>
                  <select className={control} value={columnMap[field] ?? ""} onChange={(e) => setColumnMap((m) => ({ ...m, [field]: e.target.value }))}>
                    <option value="">Not imported</option>
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-title-sm font-semibold text-ink">Filters</h3>
            {filters.length === 0 && <p className="text-caption text-muted">No filters: every row in the table is eligible.</p>}
            {filters.map((f, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <select
                  className={`${control} w-[200px]`}
                  value={f.column}
                  onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}
                >
                  {columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  className={`${control} w-[190px]`}
                  value={f.operator}
                  onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, operator: e.target.value as FilterOperator } : x)))}
                >
                  {Object.entries(FILTER_OPERATORS).map(([op, meta]) => (
                    <option key={op} value={op}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                {FILTER_OPERATORS[f.operator].values > 0 && (
                  <input
                    className={`${control} w-[220px]`}
                    value={f.value ?? ""}
                    placeholder={f.operator === "in" ? "new, working, won" : "value"}
                    onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                )}
                <button type="button" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))} className="inline-flex min-h-11 items-center px-2 text-muted hover:text-error">
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setFilters((fs) => [...fs, { column: columns[0]?.name ?? "", operator: "eq", value: "" }])}
              className="inline-flex min-h-11 w-fit items-center rounded-full border border-line bg-surface px-4 text-button text-ink hover:border-line-strong"
            >
              Add a filter
            </button>

            <label className="flex items-start gap-3 rounded-lg border border-line p-4">
              <input type="checkbox" checked={skipImported} onChange={(e) => setSkipImported(e.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" />
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-semibold text-ink">Skip rows already taken</span>
                <span className="text-caption text-muted">Your CRM is read-only to us, so what has been imported is remembered here instead of marked there.</span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">Add to list</span>
              <select className={control} value={listId} onChange={(e) => setListId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Choose a list</option>
                {lists.map((l) => (
                  <option key={l.list_id} value={l.list_id}>
                    {l.list_id} · {l.list_name ?? "Unnamed"} {l.campaign_id ? `(${l.campaign_id})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">Owned by</span>
              <select className={control} value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Nobody — open to the campaign</option>
                {agents.map((a) => (
                  <option key={a.user_name} value={a.user_name}>
                    {a.user_name} {a.full_name ? `· ${a.full_name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">How many at most</span>
              <input type="number" min={1} max={20000} className={control} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runPreview}
              disabled={!table || !columnMap.phoneNumber || busy !== null}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong disabled:opacity-60"
            >
              {busy === "preview" ? "Reading…" : "Preview 25 rows"}
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!table || !columnMap.phoneNumber || listId === "" || busy !== null}
              className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover disabled:opacity-60"
            >
              {busy === "import" ? "Importing…" : `Import up to ${limit}`}
            </button>
          </div>

          {preview && (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
              <p className="text-caption text-graphite">
                <strong className="text-ink tabular-nums">{preview.rows.length}</strong> row{preview.rows.length === 1 ? "" : "s"} match
                {preview.unusable > 0 && <span className="text-warning"> · {preview.unusable} without a usable phone number</span>}
                {preview.excluded > 0 && <span className="text-muted"> · {preview.excluded} already taken, skipped</span>}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-caption">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="py-2 pr-4 font-medium text-graphite">Phone</th>
                      <th className="py-2 pr-4 font-medium text-graphite">Name</th>
                      <th className="py-2 pr-4 font-medium text-graphite">State</th>
                      <th className="py-2 font-medium text-graphite">Source id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 10).map((r) => (
                      <tr key={r.sourceId} className="border-b border-line last:border-0">
                        <td className={`py-2 pr-4 tabular-nums ${r.phone ? "text-ink" : "text-error"}`}>{r.phone ?? `unusable: ${r.values.phoneNumber ?? "empty"}`}</td>
                        <td className="py-2 pr-4">{[r.values.firstName, r.values.lastName].filter(Boolean).join(" ") || "—"}</td>
                        <td className="py-2 pr-4">{r.values.state ?? "—"}</td>
                        <td className="py-2 text-muted">{r.sourceId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
