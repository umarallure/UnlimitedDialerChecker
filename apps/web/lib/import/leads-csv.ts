/**
 * Parsing and mapping for lead CSVs.
 *
 * A CRM export never matches VICIdial's field names, so the importer maps columns rather than
 * demanding a fixed header row. Everything here is pure, so the mapping and validation rules
 * are unit-tested instead of discovered against a live dialer.
 */

export const LEAD_FIELDS = [
  "phoneNumber",
  "firstName",
  "lastName",
  "address1",
  "city",
  "state",
  "postalCode",
  "email",
  "altPhone",
  "comments",
  "vendorLeadCode",
] as const;

export type LeadField = (typeof LEAD_FIELDS)[number];

export const FIELD_LABEL: Record<LeadField, string> = {
  phoneNumber: "Phone number",
  firstName: "First name",
  lastName: "Last name",
  address1: "Address",
  city: "City",
  state: "State",
  postalCode: "Postcode",
  email: "Email",
  altPhone: "Second phone",
  comments: "Notes",
  vendorLeadCode: "Your reference",
};

/** Header spellings seen in CRM exports, lower-cased and stripped of punctuation. */
const HEADER_HINTS: Record<LeadField, string[]> = {
  phoneNumber: ["phone", "phonenumber", "phone1", "primaryphone", "mobile", "cell", "cellphone", "telephone", "contactnumber", "number"],
  firstName: ["first", "firstname", "fname", "givenname"],
  lastName: ["last", "lastname", "lname", "surname", "familyname"],
  address1: ["address", "address1", "street", "streetaddress", "addressline1"],
  city: ["city", "town", "locality"],
  state: ["state", "province", "region", "st"],
  postalCode: ["zip", "zipcode", "postal", "postalcode", "postcode"],
  email: ["email", "emailaddress", "mail"],
  altPhone: ["phone2", "altphone", "alternatephone", "secondaryphone", "homephone", "workphone"],
  comments: ["comments", "notes", "note", "remarks", "description"],
  vendorLeadCode: ["id", "leadid", "reference", "ref", "externalid", "crmid", "recordid", "code"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Split CSV text into rows, honouring quoted fields (a CRM export will have commas inside
 * addresses and notes) and both line-ending styles.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Strip a UTF-8 byte order mark, which Excel adds and which would corrupt the first header.
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  row.push(field);
  if (row.some((f) => f.trim().length > 0)) rows.push(row);

  return rows.map((r) => r.map((f) => f.trim()));
}

/** Best guess at which column is which, for the mapping form to start from. */
export function suggestMapping(headers: string[]): Partial<Record<LeadField, number>> {
  const mapping: Partial<Record<LeadField, number>> = {};
  const used = new Set<number>();

  // Two passes, not one. A single pass lets an earlier field win a column on a loose match that
  // a later field matches exactly: "Email Address" contains "address", so address1 would claim
  // the email column before email ever saw it.
  for (const field of LEAD_FIELDS) {
    const hints = HEADER_HINTS[field];
    const exact = headers.findIndex((h, i) => !used.has(i) && hints.includes(normalizeHeader(h)));
    if (exact >= 0) {
      mapping[field] = exact;
      used.add(exact);
    }
  }

  for (const field of LEAD_FIELDS) {
    if (mapping[field] !== undefined) continue;
    const hints = HEADER_HINTS[field];
    const loose = headers.findIndex((h, i) => !used.has(i) && hints.some((hint) => normalizeHeader(h).includes(hint)));
    if (loose >= 0) {
      mapping[field] = loose;
      used.add(loose);
    }
  }

  return mapping;
}

/** Digits only, dropping a leading US country code. */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : null;
}

export type MappedLead = {
  phoneNumber: string;
  firstName?: string;
  lastName?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  email?: string;
  altPhone?: string;
  comments?: string;
  vendorLeadCode?: string;
};

export type RowProblem = { line: number; phone: string; reason: string };

export type MappedRows = {
  leads: MappedLead[];
  skipped: RowProblem[];
  /** Phone numbers repeated inside the file itself. */
  duplicatesInFile: number;
};

const MAX_LENGTHS: Partial<Record<LeadField, number>> = {
  firstName: 30,
  lastName: 30,
  address1: 100,
  city: 50,
  state: 2,
  postalCode: 10,
  email: 70,
  comments: 255,
  vendorLeadCode: 20,
};

function take(value: string | undefined, field: LeadField): string | undefined {
  if (!value) return undefined;
  const max = MAX_LENGTHS[field];
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Turn data rows into leads. A row without a usable phone number is reported rather than
 * dropped quietly, because silently importing 900 of 1000 rows is how lists go missing.
 */
export function mapRows(rows: string[][], mapping: Partial<Record<LeadField, number>>, hasHeader = true): MappedRows {
  const body = hasHeader ? rows.slice(1) : rows;
  const phoneCol = mapping.phoneNumber;
  const leads: MappedLead[] = [];
  const skipped: RowProblem[] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;

  if (phoneCol === undefined) return { leads, skipped, duplicatesInFile };

  body.forEach((row, n) => {
    const line = n + (hasHeader ? 2 : 1);
    const raw = row[phoneCol] ?? "";
    const phone = normalizePhone(raw);

    if (!phone) {
      skipped.push({ line, phone: raw, reason: raw.trim() ? "Not a valid US number" : "No phone number" });
      return;
    }
    if (seen.has(phone)) {
      duplicatesInFile++;
      skipped.push({ line, phone, reason: "Repeated earlier in this file" });
      return;
    }
    seen.add(phone);

    const value = (field: LeadField) => {
      const i = mapping[field];
      return i === undefined ? undefined : take(row[i], field);
    };

    const state = value("state");
    leads.push({
      phoneNumber: phone,
      firstName: value("firstName"),
      lastName: value("lastName"),
      address1: value("address1"),
      city: value("city"),
      state: state ? state.toUpperCase() : undefined,
      postalCode: value("postalCode"),
      email: value("email"),
      altPhone: value("altPhone"),
      comments: value("comments"),
      vendorLeadCode: value("vendorLeadCode"),
    });
  });

  return { leads, skipped, duplicatesInFile };
}

/** Leads are sent to the dialer in chunks: one command per chunk keeps each row small. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
