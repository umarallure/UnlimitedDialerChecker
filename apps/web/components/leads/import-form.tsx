"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { FIELD_LABEL, LEAD_FIELDS, type LeadField, mapRows, parseCsv, suggestMapping } from "@/lib/import/leads-csv";

export type ListOption = { list_id: number; list_name: string | null; campaign_id: string | null; active: boolean };
export type AgentOption = { user_name: string; full_name: string | null };

const control = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink focus:border-ink focus:outline-none";

type Progress = { total: number; added: number; duplicates: number; failed: number; pending: number };

export function LeadImportForm({ lists, agents }: { lists: ListOption[]; agents: AgentOption[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<LeadField, number>>>({});
  const [listId, setListId] = useState<number | "">(lists.find((l) => l.active)?.list_id ?? "");
  const [owner, setOwner] = useState("");
  const [dncCheck, setDncCheck] = useState(true);
  const [duplicateCheck, setDuplicateCheck] = useState<"DUPLIST" | "DUPCAMP" | "DUPSYS" | "NONE">("DUPLIST");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const headers = rows[0] ?? [];
  const mapped = useMemo(() => (rows.length > 1 ? mapRows(rows, mapping) : null), [rows, mapping]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      toast.error("That file has no rows", { description: "Expected a header row and at least one lead." });
      return;
    }
    setRows(parsed);
    setMapping(suggestMapping(parsed[0]));
    setFileName(file.name);
    setProgress(null);
  }

  async function submit() {
    if (!mapped || listId === "") return;
    setBusy(true);
    setProgress(null);

    const res = await fetch("/api/leads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listId, owner: owner || undefined, dncCheck, duplicateCheck, fileName, leads: mapped.leads }),
    }).catch(() => null);

    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setBusy(false);
      toast.error("Import not queued", { description: body.error ?? "Check your connection and try again." });
      return;
    }

    toast.success(`${mapped.leads.length} lead${mapped.leads.length === 1 ? "" : "s"} queued`, {
      description: `Sent to the dialer in ${body.commands} batch${body.commands === 1 ? "" : "es"}.`,
    });

    // Follow the job until the dialer has worked through every batch.
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const p = await fetch(`/api/leads/import?id=${body.importId}`).catch(() => null);
      if (!p?.ok) continue;
      const job = (await p.json()) as Progress & { finished_at: string | null };
      setProgress(job);
      if (job.finished_at || job.pending === 0) break;
    }

    setBusy(false);
    router.refresh();
  }

  const ready = mapped !== null && mapped.leads.length > 0 && listId !== "" && !busy;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={onFile} className="sr-only" id="lead-csv" />
        <label
          htmlFor="lead-csv"
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong"
        >
          <FileUp aria-hidden className="size-4" />
          {fileName ? "Choose another file" : "Choose a CSV file"}
        </label>
        {fileName && (
          <span className="text-caption text-muted">
            {fileName} · {rows.length - 1} row{rows.length - 1 === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {rows.length > 1 && (
        <>
          <div className="flex flex-col gap-3">
            <h3 className="text-title-sm font-semibold text-ink">Match your columns</h3>
            <p className="text-caption text-muted">
              A phone number is required. Anything left as “Not imported” is ignored.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {LEAD_FIELDS.map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-caption text-graphite">
                    {FIELD_LABEL[field]}
                    {field === "phoneNumber" && <span className="text-error"> *</span>}
                  </span>
                  <select
                    className={control}
                    value={mapping[field] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                  >
                    <option value="">Not imported</option>
                    {headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">Add to list</span>
              <select className={control} value={listId} onChange={(e) => setListId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Choose a list</option>
                {lists.map((l) => (
                  <option key={l.list_id} value={l.list_id}>
                    {l.list_id} · {l.list_name ?? "Unnamed"} {l.campaign_id ? `(${l.campaign_id})` : ""} {l.active ? "" : "— inactive"}
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
              <span className="text-legal text-muted">On a campaign restricted to owned leads, only this agent will dial them.</span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-caption text-graphite">Duplicates</span>
              <select className={control} value={duplicateCheck} onChange={(e) => setDuplicateCheck(e.target.value as typeof duplicateCheck)}>
                <option value="DUPLIST">Skip if already in this list</option>
                <option value="DUPCAMP">Skip if already in this campaign</option>
                <option value="DUPSYS">Skip if anywhere on the dialer</option>
                <option value="NONE">Import anyway</option>
              </select>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-line p-4">
              <input type="checkbox" checked={dncCheck} onChange={(e) => setDncCheck(e.target.checked)} className="mt-1 size-4 accent-[var(--color-primary)]" />
              <span className="flex flex-col gap-0.5">
                <span className="text-body font-semibold text-ink">Check against do-not-call</span>
                <span className="text-caption text-muted">Leads on the internal DNC list are refused rather than imported.</span>
              </span>
            </label>
          </div>

          {mapped && (
            <div className="flex flex-col gap-3 rounded-lg bg-surface-alt p-4">
              <p className="text-caption text-graphite">
                <strong className="text-ink tabular-nums">{mapped.leads.length}</strong> ready to import
                {mapped.skipped.length > 0 && (
                  <>
                    {" · "}
                    <strong className="text-ink tabular-nums">{mapped.skipped.length}</strong> skipped
                  </>
                )}
              </p>
              {mapped.skipped.length > 0 && (
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-legal text-muted">
                  {mapped.skipped.slice(0, 25).map((s) => (
                    <li key={`${s.line}-${s.phone}`}>
                      Line {s.line}: {s.reason}
                      {s.phone ? ` (${s.phone})` : ""}
                    </li>
                  ))}
                  {mapped.skipped.length > 25 && <li>…and {mapped.skipped.length - 25} more</li>}
                </ul>
              )}
            </div>
          )}

          {progress && (
            <div className="flex flex-col gap-2 rounded-lg border border-line p-4 text-caption">
              <p className="text-ink">
                {progress.pending > 0 ? "Importing…" : "Import finished"} — {progress.added} added, {progress.duplicates} already there, {progress.failed} failed, of{" "}
                {progress.total}
              </p>
              <span aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-success transition-[width]"
                  style={{ width: `${Math.min(100, Math.round(((progress.added + progress.duplicates + progress.failed) / Math.max(progress.total, 1)) * 100))}%` }}
                />
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-60"
          >
            <Upload aria-hidden className="size-4" />
            {busy ? "Importing…" : `Import ${mapped?.leads.length ?? 0} leads`}
          </button>
        </>
      )}
    </div>
  );
}
