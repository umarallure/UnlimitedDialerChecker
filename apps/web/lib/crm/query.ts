/**
 * Builds the SELECT that reads leads out of a CRM database.
 *
 * Values are always bound as parameters. Identifiers cannot be — Postgres has no parameter for
 * a table or column name — so every identifier used here must first be checked against the
 * names the database itself reported. That check is the whole defence, and it is why this
 * module refuses anything it was not told about rather than quoting and hoping.
 */

export const FILTER_OPERATORS = {
  eq: { label: "is", values: 1 },
  neq: { label: "is not", values: 1 },
  gt: { label: "is after / greater than", values: 1 },
  gte: { label: "is at or after", values: 1 },
  lt: { label: "is before / less than", values: 1 },
  lte: { label: "is at or before", values: 1 },
  contains: { label: "contains", values: 1 },
  starts_with: { label: "starts with", values: 1 },
  in: { label: "is one of", values: 1 },
  is_null: { label: "is empty", values: 0 },
  not_null: { label: "is not empty", values: 0 },
} as const;

export type FilterOperator = keyof typeof FILTER_OPERATORS;

export type Filter = { column: string; operator: FilterOperator; value?: string };

/**
 * How a value should be compared for a column of this type.
 *
 * Comparing as text is right for a stage name and wrong for anything ordered: as text,
 * '2026-9-1' sorts after '2026-10-1', and 9 sorts after 10. So dates and numbers are compared
 * as dates and numbers.
 */
export type ColumnKind = "text" | "date" | "number";

export function kindOf(dataType: string): ColumnKind {
  const t = dataType.toLowerCase();
  if (t.includes("timestamp") || t === "date") return "date";
  if (/^(smallint|integer|bigint|numeric|decimal|real|double precision)/.test(t)) return "number";
  return "text";
}

function castFor(kind: ColumnKind): { left: (col: string) => string; right: (p: string) => string } {
  switch (kind) {
    case "date":
      // A plain date means the whole day, so the right-hand side is cast, not the column.
      return { left: (c) => c, right: (p) => `${p}::timestamptz` };
    case "number":
      return { left: (c) => c, right: (p) => `${p}::numeric` };
    default:
      return { left: (c) => `${c}::text`, right: (p) => p };
  }
}

export type BuiltQuery = { text: string; values: unknown[] };

/** Postgres identifier quoting: wrap in double quotes and double any inside. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class UnknownColumnError extends Error {
  constructor(name: string) {
    super(`The column "${name}" is not in that table any more. Re-check the connection and try again.`);
    this.name = "UnknownColumnError";
  }
}

function assertKnown(name: string, known: string[]): string {
  if (!known.includes(name)) throw new UnknownColumnError(name);
  return quoteIdent(name);
}

/**
 * WHERE clause from the filters an operator chose. `known` is the column list read from the
 * source table, so a column that does not exist stops the query rather than reaching the database.
 */
export function buildWhere(
  filters: Filter[],
  known: string[],
  startAt = 1,
  kinds: Record<string, ColumnKind> = {},
): { sql: string; values: unknown[] } {
  const parts: string[] = [];
  const values: unknown[] = [];
  let n = startAt;

  for (const f of filters) {
    const col = assertKnown(f.column, known);
    const cast = castFor(kinds[f.column] ?? "text");
    const raw = (f.value ?? "").trim();

    switch (f.operator) {
      case "is_null":
        parts.push(`(${col} is null or ${col}::text = '')`);
        break;
      case "not_null":
        parts.push(`(${col} is not null and ${col}::text <> '')`);
        break;
      case "contains":
        parts.push(`${col}::text ilike $${n++}`);
        values.push(`%${raw}%`);
        break;
      case "starts_with":
        parts.push(`${col}::text ilike $${n++}`);
        values.push(`${raw}%`);
        break;
      case "in": {
        // "a, b, c" or one per line, so a list can be pasted in.
        const items = raw
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (items.length === 0) continue;
        parts.push(`${col}::text = any($${n++})`);
        values.push(items);
        break;
      }
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const op = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[f.operator];
        parts.push(`${cast.left(col)} ${op} ${cast.right(`$${n++}`)}`);
        values.push(raw);
        break;
      }
    }
  }

  return { sql: parts.length ? `where ${parts.join(" and ")}` : "", values };
}

export type SelectOptions = {
  schema: string;
  table: string;
  /** Columns to read: the mapped ones plus whatever identifies a row. */
  columns: string[];
  knownColumns: string[];
  knownTables: string[];
  /** Column types, so a date range compares dates rather than the text they print as. */
  kinds?: Record<string, ColumnKind>;
  filters: Filter[];
  /** Source ids already imported, excluded so a second run does not reload them. */
  excludeIds?: { column: string; ids: string[] };
  limit: number;
  offset?: number;
  orderBy?: string;
};

/** A read-only SELECT against the source table. */
export function buildSelect(o: SelectOptions): BuiltQuery {
  if (!o.knownTables.includes(o.table)) {
    throw new Error(`The table "${o.table}" is not in that database any more.`);
  }
  if (o.columns.length === 0) throw new Error("No columns were chosen to read.");

  const cols = o.columns.map((c) => assertKnown(c, o.knownColumns)).join(", ");
  const where = buildWhere(o.filters, o.knownColumns, 1, o.kinds ?? {});
  const values = [...where.values];
  let n = values.length + 1;

  let sql = `select ${cols} from ${quoteIdent(o.schema)}.${quoteIdent(o.table)} ${where.sql}`;

  if (o.excludeIds && o.excludeIds.ids.length > 0) {
    const col = assertKnown(o.excludeIds.column, o.knownColumns);
    sql += `${where.sql ? " and" : " where"} ${col}::text <> all($${n++})`;
    values.push(o.excludeIds.ids);
  }

  if (o.orderBy) sql += ` order by ${assertKnown(o.orderBy, o.knownColumns)}`;

  sql += ` limit $${n++}`;
  values.push(Math.min(Math.max(o.limit, 1), 20000));

  if (o.offset && o.offset > 0) {
    sql += ` offset $${n++}`;
    values.push(o.offset);
  }

  return { text: sql, values };
}
