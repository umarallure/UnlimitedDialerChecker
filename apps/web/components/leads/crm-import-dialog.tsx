"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { describeSplit, type Target } from "@/lib/crm/distribute";
import type { Filter } from "@/lib/crm/query";
import type { AgentOption } from "./import-form";
import { MultiSelect } from "./multi-select";

type Column = { name: string; type: string };
type Value = { value: string | null; count: number };
type PreviewRow = { sourceId: string; phone: string | null; values: Record<string, string | null> };

export type AgentTarget = AgentOption & { listId: number | null; campaignId: string | null };

const control = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";

/** Columns to read, by the names a CRM usually gives them. */
const GUESSES: Record<string, RegExp> = {
  phoneNumber: /^(phone|phone_number|mobile|cell)$/i,
  firstName: /^(first_name|firstname|fname)$/i,
  lastName: /^(last_name|lastname|lname|surname)$/i,
  city: /^(city|town)$/i,
  state: /^state$/i,
  postalCode: /^(zip|zip_code|postal_code|postcode)$/i,
  email: /^email$/i,
  address1: /^(address|address1|street)$/i,
};

/** The table holding leads, so nobody has to pick it every time. */
function pickLeadTable(tables: string[], remembered?: string | null): string {
  if (remembered && tables.includes(remembered)) return remembered;
  return tables.find((t) => t === "leads") ?? tables.find((t) => /^leads?$/i.test(t)) ?? tables.find((t) => /lead/i.test(t)) ?? tables[0] ?? "";
}

/** Import leads from the CRM: what to bring, and who gets them. */
export function CrmImportDialog({
  connectionId,
  rememberedTable,
  agents,
  open,
  onClose,
}: {
  connectionId: string;
  rememberedTable: string | null;
  agents: AgentTarget[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const [table, setTable] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [stageColumn, setStageColumn] = useState("");
  const [languageColumn, setLanguageColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [sourceIdColumn, setSourceIdColumn] = useState("");

  const [stageValues, setStageValues] = useState<Value[]>([]);
  const [languageValues, setLanguageValues] = useState<Value[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(500);

  const [chosen, setChosen] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; unusable: number; excluded: number } | null>(null);
  const [busy, setBusy] = useState<"loading" | "preview" | "import" | null>(null);

  const columnMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [field, pattern] of Object.entries(GUESSES)) {
      const hit = columns.find((c) => pattern.test(c.name));
      if (hit) map[field] = hit.name;
    }
    return map;
  }, [columns]);

  const filters = useMemo<Filter[]>(() => {
    const out: Filter[] = [];
    if (stages.length > 0) out.push({ column: stageColumn, operator: "in", value: stages.join(",") });
    if (languages.length > 0) out.push({ column: languageColumn, operator: "in", value: languages.join(",") });
    if (from) out.push({ column: dateColumn, operator: "gte", value: from });
    // A day means the whole day, so "to" is the start of the next one.
    if (to) out.push({ column: dateColumn, operator: "lt", value: nextDay(to) });
    return out;
  }, [stages, languages, from, to, stageColumn, languageColumn, dateColumn]);

  const targets: Target[] = chosen
    .map((owner) => agents.find((a) => a.user_name === owner))
    .filter((a): a is AgentTarget => Boolean(a && a.listId))
    .map((a) => ({ owner: a.user_name, listId: a.listId as number, campaignId: a.campaignId }));

  const loadValues = useCallback(
    async (forTable: string, column: string, set: (v: Value[]) => void) => {
      const res = await fetch(`/api/crm/values?id=${connectionId}&table=${encodeURIComponent(forTable)}&column=${encodeURIComponent(column)}`).catch(() => null);
      if (!res?.ok) return;
      const body = await res.json();
      set(body.values ?? []);
    },
    [connectionId],
  );

  const load = useCallback(
    async (forTable?: string) => {
      // Yield first: this runs from an effect when the dialog opens, and setting state
      // synchronously inside an effect body causes a cascading render.
      await Promise.resolve();
      setBusy("loading");
      const first = await fetch(`/api/crm/schema?id=${connectionId}`).catch(() => null);
      const firstBody = first ? await first.json().catch(() => ({})) : {};
      if (!first?.ok) {
        toast.error("Could not read the CRM", { description: firstBody.error });
        setBusy(null);
        return;
      }

      const all: string[] = firstBody.tables ?? [];
      setTables(all);
      const chosenTable = forTable ?? pickLeadTable(all, rememberedTable);
      setTable(chosenTable);
      if (!chosenTable) {
        setBusy(null);
        return;
      }

      const res = await fetch(`/api/crm/schema?id=${connectionId}&table=${encodeURIComponent(chosenTable)}`).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (!res?.ok) {
        toast.error("Could not read that table", { description: body.error });
        setBusy(null);
        return;
      }

      const cols: Column[] = body.columns ?? [];
      setColumns(cols);
      const pick = (want: string, fallback: RegExp) => cols.find((c) => c.name === want)?.name ?? cols.find((c) => fallback.test(c.name))?.name ?? "";
      const stageCol = pick("stage", /stage|status/i);
      const langCol = pick("language", /language|lang/i);
      setStageColumn(stageCol);
      setLanguageColumn(langCol);
      setDateColumn(pick("created_at", /created|added|date/i));
      setSourceIdColumn(cols.find((c) => c.name === "id")?.name ?? cols[0]?.name ?? "");

      setStageValues([]);
      setLanguageValues([]);
      if (stageCol) await loadValues(chosenTable, stageCol, setStageValues);
      if (langCol) await loadValues(chosenTable, langCol, setLanguageValues);
      setBusy(null);
    },
    [connectionId, rememberedTable, loadValues],
  );

  useEffect(() => {
    if (!open) return;
    // Deferred by a tick so the first state update lands after this effect rather than
    // during it, which would cascade a render. Cancelled if the dialog closes straight away.
    let cancelled = false;
    const start = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [open, load]);

  async function runPreview() {
    setBusy("preview");
    const res = await fetch("/api/crm/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: connectionId, table, columnMap, sourceIdColumn, filters, skipImported: true, limit: 25 }),
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
    setBusy("import");
    const res = await fetch("/api/crm/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: connectionId, table, columnMap, sourceIdColumn, filters, skipImported: true, limit, targets }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) {
      toast.error("Import failed", { description: body.error });
      return;
    }
    const split = (body.split as { owner: string; leads: number }[]).map((s) => `${s.owner} ${s.leads}`).join(" · ");
    toast.success(`${body.total} lead${body.total === 1 ? "" : "s"} queued`, { description: split });
    setPreview(null);
    onClose();
    router.refresh();
  }

  const ready = targets.length > 0 && Boolean(columnMap.phoneNumber) && busy === null;
  const matching = preview?.rows.length;

  return (
    <Modal open={open} onClose={onClose} title="Import leads" description={table ? `From ${table}` : "Reading the CRM…"} width={720}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-caption text-graphite">Stage</span>
            <MultiSelect
              options={stageValues.map((v) => ({ value: v.value ?? "", label: v.value || "(empty)", count: v.count }))}
              selected={stages}
              onChange={setStages}
              placeholder={busy === "loading" ? "Loading…" : "Every stage"}
              emptyLabel="No stages found"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-caption text-graphite">Language</span>
            <MultiSelect
              options={languageValues.filter((v) => v.value).map((v) => ({ value: v.value ?? "", label: v.value ?? "", count: v.count }))}
              selected={languages}
              onChange={setLanguages}
              placeholder="Any language"
              emptyLabel="No languages found"
              search={false}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-caption text-graphite">Created from</span>
            <input type="date" className={control} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-graphite">Created to</span>
            <input type="date" className={control} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption text-graphite">How many at most</span>
            <input type="number" min={1} max={20000} className={control} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-caption text-graphite">Share between</span>
          <div className="flex flex-wrap gap-2">
            {agents.length === 0 && <p className="text-caption text-muted">No agents with a list of their own yet.</p>}
            {agents.map((a) => {
              const on = chosen.includes(a.user_name);
              const usable = Boolean(a.listId);
              return (
                <button
                  key={a.user_name}
                  type="button"
                  disabled={!usable}
                  onClick={() => setChosen((c) => (on ? c.filter((x) => x !== a.user_name) : [...c, a.user_name]))}
                  title={usable ? `${a.campaignId} · list ${a.listId}` : "No list of their own yet"}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-button transition-colors disabled:opacity-40 ${
                    on ? "border-primary bg-soft-orange text-primary-pressed" : "border-line bg-surface text-ink hover:border-line-strong"
                  }`}
                >
                  {a.full_name || a.user_name}
                </button>
              );
            })}
          </div>
        </div>

        <p className="rounded-lg bg-surface-alt p-3 text-caption text-graphite">
          {targets.length === 0
            ? "Choose who gets these leads. Each agent's share goes to their own list, owned by them."
            : `${describeSplit(matching ?? limit, targets)}${matching === undefined ? ", of whatever matches" : ""}`}
          {preview && (
            <span className="text-muted">
              {" "}
              · {preview.rows.length} in the first 25 checked
              {preview.unusable > 0 && `, ${preview.unusable} without a usable number`}
              {preview.excluded > 0 && `, ${preview.excluded} already taken`}
            </span>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={runImport}
            disabled={!ready}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover disabled:opacity-60"
          >
            <Download aria-hidden className="size-4" />
            {busy === "import" ? "Importing…" : `Import up to ${limit}`}
          </button>
          <button
            type="button"
            onClick={runPreview}
            disabled={busy !== null || !columnMap.phoneNumber}
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong disabled:opacity-60"
          >
            {busy === "preview" ? "Checking…" : "Check first"}
          </button>

          {/* Only worth showing when the guess was wrong. */}
          {tables.length > 1 && (
            <select
              className="ml-auto h-11 rounded-md border border-line bg-surface px-3 text-legal text-muted"
              value={table}
              onChange={(e) => {
                setStages([]);
                setLanguages([]);
                setPreview(null);
                void load(e.target.value);
              }}
            >
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </div>

        {!columnMap.phoneNumber && columns.length > 0 && <p className="text-legal text-error">No phone column in {table}. Choose another table.</p>}
      </div>
    </Modal>
  );
}

/** The day after `yyyy-mm-dd`, so "created to" includes everything on that date. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
