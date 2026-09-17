import { stateForAreaCode } from "./area-codes";

/** Parsing and validation for DID CSV imports. Pure functions shared by the preview UI and the import API. */

export const MAX_IMPORT_ROWS = 2000;

const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

type Field = "number" | "state" | "cnam" | "attestation" | "purchasedAt" | "mrc" | "notes" | "carrier";

const HEADER_ALIASES: Record<Field, string[]> = {
  number: ["number", "phone", "phonenumber", "phone number", "did", "dids", "e164", "telephone", "tn", "callerid", "caller id", "cid", "telephone number"],
  state: ["state", "st", "province", "region"],
  cnam: ["cnam", "callername", "caller name", "display name"],
  attestation: ["attestation", "stir", "stirshaken", "stir shaken", "stir/shaken", "shaken"],
  purchasedAt: ["purchased", "purchasedat", "purchased at", "purchase date", "activated", "activation date", "activated at", "order date", "date"],
  mrc: ["mrc", "monthly", "monthly cost", "monthly price", "price", "rate", "cost"],
  notes: ["notes", "note", "comment", "comments", "description", "label"],
  carrier: ["carrier", "provider", "vendor"],
};

export type ExistingDid = { e164: string; lifecycle: string; notes: string | null };

export type RowStatus = "new" | "update" | "duplicate" | "invalid";

export type ImportRow = {
  line: number;
  input: string;
  e164: string | null;
  areaCode: string | null;
  state: string | null;
  stateSource: "file" | "area code" | null;
  cnam: string | null;
  attestation: "A" | "B" | "C" | null;
  purchasedAt: string | null;
  mrcCents: number | null;
  notes: string | null;
  carrier: string;
  status: RowStatus;
  errors: string[];
  warnings: string[];
};

export type ParseResult = {
  rows: ImportRow[];
  hasHeader: boolean;
  mappedColumns: Partial<Record<Field, string>>;
  error: string | null;
};

/** RFC 4180 CSV parsing with quoted fields; detects comma, tab or semicolon delimiters. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Normalize to E.164 (+1NXXNXXXXXX) or null. */
export function normalizeNumber(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  header.forEach((h, idx) => {
    const n = normHeader(h);
    const compact = n.replace(/\s/g, "");
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
      if (map[field] !== undefined) continue;
      if (aliases.includes(n) || aliases.includes(compact)) {
        map[field] = idx;
        break;
      }
    }
  });
  return map;
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseMoneyCents(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
  return Math.round(n * 100);
}

function clip(value: string | undefined, max: number): string | null {
  const v = value?.trim();
  return v ? v.slice(0, max) : null;
}

/** Parse CSV text and classify every row against the numbers already in the pool. */
export function buildImport(text: string, existing: ExistingDid[]): ParseResult {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], hasHeader: false, mappedColumns: {}, error: "The file is empty." };

  const headerMap = mapHeader(table[0]);
  const firstCellIsNumber = normalizeNumber(table[0][0] ?? "") !== null;
  const hasHeader = headerMap.number !== undefined || !firstCellIsNumber;
  const map: Partial<Record<Field, number>> = hasHeader ? headerMap : { number: 0 };

  if (hasHeader && map.number === undefined) {
    return {
      rows: [],
      hasHeader,
      mappedColumns: {},
      error: `No phone number column found. Name it one of: number, phone, did, e164. Columns seen: ${table[0].join(", ")}`,
    };
  }

  const body = hasHeader ? table.slice(1) : table;
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], hasHeader, mappedColumns: {}, error: `Too many rows (${body.length}). Import at most ${MAX_IMPORT_ROWS} at a time.` };
  }

  const existingByE164 = new Map(existing.map((d) => [d.e164, d]));
  const seen = new Set<string>();
  const cell = (r: string[], f: Field) => (map[f] === undefined ? "" : (r[map[f]!] ?? ""));

  const rows: ImportRow[] = body.map((r, i) => {
    const line = i + 1 + (hasHeader ? 1 : 0);
    const input = cell(r, "number").trim();
    const errors: string[] = [];
    const warnings: string[] = [];

    const e164 = normalizeNumber(input);
    const areaCode = e164 ? e164.slice(2, 5) : null;
    if (!input) errors.push("Missing phone number");
    else if (!e164) errors.push("Not a valid US or Canada 10-digit number");

    if (areaCode && TOLL_FREE.has(areaCode)) errors.push("Toll-free numbers can’t be used for local presence");

    const lookup = areaCode ? stateForAreaCode(areaCode) : null;
    if (areaCode && !TOLL_FREE.has(areaCode) && !lookup) warnings.push(`Unknown area code ${areaCode}`);
    if (lookup?.country === "CA") warnings.push("Canadian number");

    const fileState = cell(r, "state").trim().toUpperCase();
    let state: string | null = null;
    let stateSource: ImportRow["stateSource"] = null;
    if (fileState) {
      if (/^[A-Z]{2}$/.test(fileState)) {
        state = fileState;
        stateSource = "file";
        if (lookup && lookup.state !== fileState) warnings.push(`State ${fileState} doesn’t match area code (${lookup.state})`);
      } else warnings.push(`Ignored state “${fileState}” (use a 2-letter code)`);
    }
    if (!state && lookup) {
      state = lookup.state;
      stateSource = "area code";
    }

    const attRaw = cell(r, "attestation").trim().toUpperCase();
    const attestation = attRaw === "A" || attRaw === "B" || attRaw === "C" ? attRaw : null;
    if (attRaw && !attestation) warnings.push(`Ignored attestation “${attRaw}”`);
    if (attestation && attestation !== "A") warnings.push(`Attestation ${attestation}: only A-attested numbers should dial`);

    const dateRaw = cell(r, "purchasedAt");
    const purchasedAt = parseDate(dateRaw);
    if (dateRaw.trim() && !purchasedAt) warnings.push(`Ignored date “${dateRaw.trim()}”`);

    const mrcRaw = cell(r, "mrc");
    const mrcCents = parseMoneyCents(mrcRaw);
    if (mrcRaw.trim() && mrcCents === null) warnings.push(`Ignored monthly cost “${mrcRaw.trim()}”`);

    let status: RowStatus;
    if (errors.length || !e164) status = "invalid";
    else if (seen.has(e164)) status = "duplicate";
    else status = existingByE164.has(e164) ? "update" : "new";
    if (e164 && status !== "invalid") seen.add(e164);

    const existingDid = e164 ? existingByE164.get(e164) : undefined;
    if (status === "update" && existingDid) warnings.push(`Already in pool (${existingDid.lifecycle}); details update, lifecycle unchanged`);

    return {
      line,
      input,
      e164,
      areaCode,
      state,
      stateSource,
      cnam: clip(cell(r, "cnam"), 15),
      attestation,
      purchasedAt,
      mrcCents,
      notes: clip(cell(r, "notes"), 500),
      carrier: (clip(cell(r, "carrier"), 40) ?? "teleinx").toLowerCase(),
      status,
      errors,
      warnings,
    };
  });

  const mappedColumns = Object.fromEntries(
    Object.entries(map).map(([f, idx]) => [f, hasHeader ? (table[0][idx as number] ?? "").trim() : "column 1"]),
  ) as Partial<Record<Field, string>>;

  return { rows, hasHeader, mappedColumns, error: null };
}

export function summarize(rows: ImportRow[]) {
  return {
    total: rows.length,
    new: rows.filter((r) => r.status === "new").length,
    update: rows.filter((r) => r.status === "update").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    warnings: rows.filter((r) => r.warnings.length && r.status !== "invalid").length,
  };
}
