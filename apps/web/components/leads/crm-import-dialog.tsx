"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Users } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/modal";
import { describeSplit, type Target } from "@/lib/crm/distribute";
import type { Filter } from "@/lib/crm/query";
import type { AgentOption } from "./import-form";

type Column = { name: string; type: string };
type Value = { value: string | null; count: number };
type PreviewRow = { sourceId: string; phone: string | null; values: Record<string, string | null> };

export type AgentTarget = AgentOption & { listId: number | null; campaignId: string | null };

const control = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";

/** Columns we try to find in the source table, by the names a CRM usually gives them. */
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

/**
 * Import leads from the CRM: pick what to bring, then who gets them.
 *
 * The filters are built from the values actually in the source table, so choosing a stage is a
 * dropdown of real stages rather than a box to type a guess into.
 */
export function CrmImportDialog({
  connectionId,
  table,
  agents,
  open,
  onClose,
}: {
  connectionId: string;
  table: string;
  agents: AgentTarget[];
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const [columns, setColumns] = useState<Column[]>([]);
  const [stageColumn, setStageColumn] = useState("stage");
  const [languageColumn, setLanguageColumn] = useState("language");
  const [dateColumn, setDateColumn] = useState("created_at");
  const [sourceIdColumn, setSourceIdColumn] = useState("id");

  const [stageValues, setStageValues] = useState<Value[]>([]);
  const [languageValues, setLanguageValues] = useState<Value[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [language, setLanguage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [skipImported, setSkipImported] = useState(true);
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
    if (language) out.push({ column: languageColumn, operator: "eq", value: language });
    if (from) out.push({ column: dateColumn, operator: "gte", value: from });
    // A day means the whole day, so "to" is the start of the next one.
    if (to) out.push({ column: dateColumn, operator: "lt", value: nextDay(to) });
    return out;
  }, [stages, language, from, to, stageColumn, languageColumn, dateColumn]);

  const targets: Target[] = chosen
    .map((owner) => agents.find((a) => a.user_name === owner))
    .filter((a): a is AgentTarget => Boolean(a && a.listId))
    .map((a) => ({ owner: a.user_name, listId: a.listId as number, campaignId: a.campaignId }));

  const loadValues = useCallback(
    async (column: string, set: (v: Value[]) => void) => {
      const res = await fetch(`/api/crm/values?id=${connectionId}&table=${encodeURIComponent(table)}&column=${encodeURIComponent(column)}`).catch(() => null);
      if (!res?.ok) return;
      const body = await res.json();
      set(body.values ?? []);
    },
    [connectionId, table],
  );

  useEffect(() => {
    if (!open) return;
    (async () => {
      setBusy("loading");
      const res = await fetch(`/api/crm/schema?id=${connectionId}&table=${encodeURIComponent(table)}`).catch(() => null);
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
      const dateCol = pick("created_at", /created|added|date/i);
      setStageColumn(stageCol);
      setLanguageColumn(langCol);
      setDateColumn(dateCol);
      setSourceIdColumn(cols.find((c) => c.name === "id")?.name ?? cols[0]?.name ?? "");

      if (stageCol) await loadValues(stageCol, setStageValues);
      if (langCol) await loadValues(langCol, setLanguageValues);
      setBusy(null);
    })();
  }, [open, connectionId, table, loadValues]);

  async function runPreview() {
    setBusy("preview");
    const res = await fetch("/api/crm/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: connectionId, table, columnMap, sourceIdColumn, filters, skipImported, limit: 25 }),
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
      body: JSON.stringify({ id: connectionId, table, columnMap, sourceIdColumn, filters, skipImported, limit, targets }),
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

  return (
    <Modal open={open} onClose={onClose} title="Import leads from the CRM" description={`Reading ${table}`} width={780}>
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <h3 className="text-title-sm font-semibold text-ink">Which leads</h3>

          <div className="flex flex-col gap-1">
            <span className="text-caption text-graphite">Stage</span>
            <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2">
              {stageValues.length === 0 && <p className="p-2 text-caption text-muted">{busy === "loading" ? "Reading stages…" : "No stage column found."}</p>}
              {stageValues.map((v) => {
                const value = v.value ?? "";
                const on = stages.includes(value);
                return (
                  <label key={value} className="flex min-h-9 items-center gap-2 rounded px-2 text-caption hover:bg-surface-alt">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setStages((s) => (e.target.checked ? [...s, value] : s.filter((x) => x !== value)))}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    <span className="flex-1 text-ink">{value || "(empty)"}</span>
                    <span className="text-legal text-muted tabular-nums">{v.count.toLocaleString()}</span>
                  </label>
                );
              })}
            </div>
            <span className="text-legal text-muted">{stages.length === 0 ? "Every stage" : `${stages.length} selected`}</span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">Language</span>
              <select className={control} value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">Any</option>
                {languageValues
                  .filter((v) => v.value)
                  .map((v) => (
                    <option key={v.value} value={v.value ?? ""}>
                      {v.value} ({v.count.toLocaleString()})
                    </option>
                  ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">Created from</span>
              <input type="date" className={control} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">Created to</span>
              <input type="date" className={control} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">How many at most</span>
              <input type="number" min={1} max={20000} className={control} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-line p-3">
              <input type="checkbox" checked={skipImported} onChange={(e) => setSkipImported(e.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" />
              <span className="flex flex-col gap-0.5">
                <span className="text-caption font-semibold text-ink">Skip leads already taken</span>
                <span className="text-legal text-muted">Remembered here, since the CRM is read-only.</span>
              </span>
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-t border-line pt-5">
          <h3 className="flex items-center gap-2 text-title-sm font-semibold text-ink">
            <Users aria-hidden className="size-4 text-muted" /> Who gets them
          </h3>

          <div className="flex flex-wrap gap-2">
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
                  {a.user_name}
                  {a.full_name ? <span className="text-legal text-muted">{a.full_name}</span> : null}
                </button>
              );
            })}
          </div>

          <p className="rounded-lg bg-surface-alt p-3 text-caption text-graphite">
            {targets.length === 0
              ? "Choose at least one agent. Each gets their own leads, owned by them, in their own list."
              : `Split evenly: ${describeSplit(preview?.rows.length ?? limit, targets)}`}
            {chosen.length > targets.length && <span className="text-warning"> · some chosen agents have no list yet and were left out</span>}
          </p>
        </section>

        {preview && (
          <section className="flex flex-col gap-2 rounded-lg border border-line p-4">
            <p className="text-caption text-graphite">
              <strong className="text-ink tabular-nums">{preview.rows.length}</strong> shown of the first 25 matching
              {preview.unusable > 0 && <span className="text-warning"> · {preview.unusable} without a usable phone number</span>}
              {preview.excluded > 0 && <span className="text-muted"> · {preview.excluded} already taken</span>}
            </p>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-legal">
              {preview.rows.slice(0, 12).map((r) => (
                <li key={r.sourceId} className={r.phone ? "text-graphite" : "text-error"}>
                  {r.phone ?? "no usable number"} · {[r.values.firstName, r.values.lastName].filter(Boolean).join(" ") || "no name"} · {r.values.state ?? "—"}
                </li>
              ))}
            </ul>
          </section>
        )}

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
            {busy === "preview" ? "Reading…" : "Preview"}
          </button>
          {!columnMap.phoneNumber && columns.length > 0 && <span className="text-legal text-error">No phone column found in that table.</span>}
        </div>
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
