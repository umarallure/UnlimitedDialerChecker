"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Alert, DataTable, Panel, PrimaryButton, SecondaryButton, StatusPill } from "@/components/ui";
import { buildImport, MAX_IMPORT_ROWS, summarize, type ExistingDid, type ImportRow, type RowStatus } from "@/lib/import/numbers-csv";
import { formatPhone } from "@/lib/time";

const TEMPLATE = "number,state,cnam,attestation,purchased,monthly cost,notes\n2125550199,NY,YOUR COMPANY,A,2026-09-20,0.25,Wave 1\n";

const STATUS: Record<RowStatus, { label: string; tone: "success" | "neutral" | "warning" | "error" }> = {
  new: { label: "New", tone: "success" },
  update: { label: "Update", tone: "neutral" },
  duplicate: { label: "Duplicate in file", tone: "warning" },
  invalid: { label: "Invalid", tone: "error" },
};

type Filter = "all" | RowStatus | "warnings";

type ImportResult = { inserted: number; updated: number; duplicate: number; invalid: number };

export function ImportForm({ existing }: { existing: ExistingDid[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);

  const preview = useMemo(() => (csv.trim() ? buildImport(csv, existing) : null), [csv, existing]);
  const counts = preview ? summarize(preview.rows) : null;
  const importable = counts ? counts.new + counts.update : 0;

  const visible = useMemo(() => {
    const rows = preview?.rows ?? [];
    if (filter === "all") return rows;
    if (filter === "warnings") return rows.filter((r) => r.warnings.length && r.status !== "invalid");
    return rows.filter((r) => r.status === filter);
  }, [preview, filter]);

  async function loadFile(file: File) {
    if (file.size > 2_000_000) {
      setServerError("That file is over 2 MB. Split it into smaller files.");
      return;
    }
    setServerError(null);
    setResult(null);
    setFileName(file.name);
    setFilter("all");
    setCsv(await file.text());
  }

  function reset() {
    setCsv("");
    setFileName(null);
    setServerError(null);
    setResult(null);
    setFilter("all");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function runImport() {
    setBusy(true);
    setServerError(null);
    try {
      const res = await fetch("/api/numbers/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, fileName: fileName ?? "pasted CSV" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const partial = body.inserted || body.updated ? ` (${body.inserted ?? 0} added, ${body.updated ?? 0} updated before it stopped)` : "";
        setServerError(`${body.error ?? `Import failed (HTTP ${res.status}).`}${partial}`);
        toast.error("Import didn’t finish", { description: `${body.error ?? "Try again."}${partial}` });
      } else {
        const r = body as ImportResult;
        setResult(r);
        toast.success(`Imported ${r.inserted} new number${r.inserted === 1 ? "" : "s"}`, {
          description: `${r.updated} updated${r.duplicate + r.invalid ? ` · ${r.duplicate + r.invalid} skipped` : ""} · from ${fileName ?? "pasted CSV"}`,
        });
        router.refresh();
      }
    } catch {
      setServerError("Couldn’t reach the server. Check your connection and try again.");
      toast.error("Import didn’t start", { description: "Couldn’t reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Panel bodyClassName="flex flex-col items-start gap-4 p-8">
        <CheckCircle2 aria-hidden className="size-10 text-success" strokeWidth={1.75} />
        <div className="flex flex-col gap-1">
          <h2 className="text-title-md font-bold text-ink">Import complete</h2>
          <p className="text-body text-graphite">
            {result.inserted} new number{result.inserted === 1 ? "" : "s"} added in Aging, {result.updated} updated.
            {result.duplicate + result.invalid > 0 && ` ${result.duplicate + result.invalid} row${result.duplicate + result.invalid === 1 ? "" : "s"} skipped.`}
          </p>
        </div>
        <p className="max-w-[65ch] text-caption text-muted">
          Next for each new number: register it on Free Caller Registry, confirm callbacks reach the IVR, and scan its reputation. It moves to
          Warming after 7 days once those checks pass.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/numbers?lifecycle=NEW" className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover">
            View new numbers
          </Link>
          <SecondaryButton onClick={reset}>Import another file</SecondaryButton>
        </div>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="1. Choose a CSV" subtitle={`Up to ${MAX_IMPORT_ROWS.toLocaleString()} rows. Only the phone number column is required.`} bodyClassName="flex flex-col gap-4 px-6 pb-6">
          <label
            htmlFor="csv-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void loadFile(file);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? "border-primary bg-soft-orange" : "border-line-strong bg-surface-alt hover:border-graphite"
            }`}
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-surface text-graphite">
              <FileUp aria-hidden className="size-6" strokeWidth={1.75} />
            </span>
            <span className="text-body font-semibold text-ink">{fileName ?? "Drop a CSV here or click to choose"}</span>
            <span className="text-caption text-muted">{fileName ? "Choose another file to replace it" : "CSV, TSV or semicolon-separated"}</span>
            <input
              ref={fileInput}
              id="csv-file"
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadFile(file);
              }}
            />
          </label>

          <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-caption text-graphite hover:text-ink [&::-webkit-details-marker]:hidden">
              Or paste CSV text →
            </summary>
            <label htmlFor="csv-paste" className="sr-only">
              CSV text
            </label>
            <textarea
              id="csv-paste"
              rows={6}
              value={fileName ? "" : csv}
              onChange={(e) => {
                setFileName(null);
                setResult(null);
                setCsv(e.target.value);
              }}
              placeholder={TEMPLATE}
              className="mt-2 w-full rounded-md border border-line-strong bg-surface px-3.5 py-3 font-mono text-code text-ink placeholder:text-muted focus:border-ink focus:outline-none"
            />
          </details>
        </Panel>

        <Panel title="Columns we read" bodyClassName="flex flex-col gap-3 px-6 pb-6 text-caption">
          <ul className="flex flex-col gap-2 text-graphite">
            <li>
              <span className="font-semibold text-ink">number</span> (required): also phone, did, e164, caller id
            </li>
            <li>
              <span className="font-semibold text-ink">state</span>: 2-letter code; filled from the area code if missing
            </li>
            <li>
              <span className="font-semibold text-ink">cnam</span>, <span className="font-semibold text-ink">attestation</span> (A/B/C),{" "}
              <span className="font-semibold text-ink">purchased</span>, <span className="font-semibold text-ink">monthly cost</span>,{" "}
              <span className="font-semibold text-ink">notes</span>, <span className="font-semibold text-ink">carrier</span> (defaults to teleinx)
            </li>
          </ul>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="numbers-template.csv"
            className="inline-flex min-h-11 items-center gap-1.5 text-graphite hover:text-ink"
          >
            Download template <span aria-hidden>→</span>
          </a>
        </Panel>
      </div>

      {serverError && <Alert>{serverError}</Alert>}
      {preview?.error && <Alert>{preview.error}</Alert>}

      {preview && !preview.error && counts && (
        <Panel
          title="2. Review"
          subtitle={
            <>
              {counts.total} row{counts.total === 1 ? "" : "s"} read
              {preview.hasHeader ? ` · number column: “${preview.mappedColumns.number}”` : " · no header row, first column used as the number"}
            </>
          }
          action={
            <div className="flex flex-wrap items-center gap-3">
              <SecondaryButton onClick={reset} disabled={busy}>
                <RotateCcw aria-hidden className="size-4" /> Start over
              </SecondaryButton>
              <PrimaryButton onClick={runImport} disabled={busy || importable === 0}>
                {busy ? "Importing…" : importable === 0 ? "Nothing to import" : `Import ${importable} number${importable === 1 ? "" : "s"}`}
              </PrimaryButton>
            </div>
          }
          bodyClassName="flex flex-col gap-4 px-2 pb-2"
        >
          <div className="flex flex-wrap gap-2 px-4" role="group" aria-label="Filter rows">
            {(
              [
                ["all", `All ${counts.total}`],
                ["new", `New ${counts.new}`],
                ["update", `Update ${counts.update}`],
                ["warnings", `Warnings ${counts.warnings}`],
                ["duplicate", `Duplicates ${counts.duplicate}`],
                ["invalid", `Invalid ${counts.invalid}`],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-button ${
                  filter === key ? "border-ink bg-ink text-on-dark" : "border-line bg-surface text-graphite hover:border-line-strong"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <DataTable head={["Row", "Number", "State", "Details", "Result"]} minWidth={760} bare>
            {visible.slice(0, 500).map((r) => (
              <PreviewRow key={`${r.line}-${r.input}`} row={r} />
            ))}
          </DataTable>
          {visible.length > 500 && <p className="px-4 pb-2 text-caption text-muted">Showing the first 500 of {visible.length} rows. All rows will be imported.</p>}
          {visible.length === 0 && <p className="px-4 pb-4 text-caption text-muted">No rows match this filter.</p>}
        </Panel>
      )}
    </div>
  );
}

function PreviewRow({ row }: { row: ImportRow }) {
  const s = STATUS[row.status];
  const extras = [row.cnam && `CNAM ${row.cnam}`, row.attestation && `Attestation ${row.attestation}`, row.purchasedAt && `Purchased ${row.purchasedAt}`, row.mrcCents !== null && `$${(row.mrcCents / 100).toFixed(2)}/mo`, row.notes]
    .filter(Boolean)
    .join(" · ");
  return (
    <tr>
      <td className="tabular-nums text-muted">{row.line}</td>
      <td>
        <span className="flex flex-col">
          <span className="font-semibold text-ink tabular-nums">{row.e164 ? formatPhone(row.e164) : row.input || "—"}</span>
          {row.e164 && row.input !== row.e164 && <span className="text-legal text-muted">{row.input}</span>}
        </span>
      </td>
      <td>
        {row.state ? (
          <span className="flex flex-col">
            <span className="text-ink">{row.state}</span>
            <span className="text-legal text-muted">from {row.stateSource}</span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="max-w-[420px]">
        <span className="flex flex-col gap-1">
          {extras && <span className="text-caption text-graphite">{extras}</span>}
          {row.errors.map((e) => (
            <span key={e} className="text-caption text-error">
              {e}
            </span>
          ))}
          {row.warnings.map((w) => (
            <span key={w} className="text-caption text-warning">
              {w}
            </span>
          ))}
          {!extras && !row.errors.length && !row.warnings.length && <span className="text-caption text-muted">—</span>}
        </span>
      </td>
      <td>
        <StatusPill tone={s.tone}>{s.label}</StatusPill>
      </td>
    </tr>
  );
}
