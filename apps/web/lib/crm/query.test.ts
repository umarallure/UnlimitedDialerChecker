import { describe, expect, it } from "vitest";
import { UnknownColumnError, buildSelect, buildWhere, quoteIdent } from "./query";

const known = ["id", "phone", "first_name", "created_at", "status", "weird name"];
const tables = ["leads", "contacts"];

describe("quoteIdent", () => {
  it("quotes and escapes, so a column with a space or a quote is still usable", () => {
    expect(quoteIdent("weird name")).toBe('"weird name"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});

describe("buildWhere", () => {
  it("binds values as parameters rather than inlining them", () => {
    const w = buildWhere([{ column: "status", operator: "eq", value: "new" }], known);
    expect(w.sql).toBe('where "status"::text = $1');
    expect(w.values).toEqual(["new"]);
  });

  it("wraps contains and starts_with in the right wildcards", () => {
    expect(buildWhere([{ column: "first_name", operator: "contains", value: "ann" }], known).values).toEqual(["%ann%"]);
    expect(buildWhere([{ column: "first_name", operator: "starts_with", value: "ann" }], known).values).toEqual(["ann%"]);
  });

  it("treats empty text as empty for is_null, since a CRM export rarely uses real nulls", () => {
    const w = buildWhere([{ column: "phone", operator: "is_null" }], known);
    expect(w.sql).toContain("is null");
    expect(w.sql).toContain("= ''");
    expect(w.values).toEqual([]);
  });

  it("accepts a list separated by commas or newlines", () => {
    const w = buildWhere([{ column: "status", operator: "in", value: "new,\n working , won" }], known);
    expect(w.values).toEqual([["new", "working", "won"]]);
  });

  it("numbers parameters across several filters", () => {
    const w = buildWhere(
      [
        { column: "status", operator: "eq", value: "new" },
        { column: "created_at", operator: "gte", value: "2026-01-01" },
      ],
      known,
    );
    expect(w.sql).toBe('where "status"::text = $1 and "created_at"::text >= $2');
    expect(w.values).toEqual(["new", "2026-01-01"]);
  });

  it("refuses a column the database did not report", () => {
    expect(() => buildWhere([{ column: "secrets", operator: "eq", value: "x" }], known)).toThrow(UnknownColumnError);
  });

  it("cannot be used to inject SQL through a column name", () => {
    expect(() => buildWhere([{ column: 'phone" from users --', operator: "eq", value: "x" }], known)).toThrow(UnknownColumnError);
  });
});

describe("buildSelect", () => {
  const base = { schema: "public", table: "leads", columns: ["id", "phone"], knownColumns: known, knownTables: tables, filters: [], limit: 100 };

  it("builds a plain read", () => {
    const q = buildSelect(base);
    expect(q.text).toBe('select "id", "phone" from "public"."leads"  limit $1');
    expect(q.values).toEqual([100]);
  });

  it("combines filters, exclusions and a limit with correct parameter numbers", () => {
    const q = buildSelect({
      ...base,
      filters: [{ column: "status", operator: "eq", value: "new" }],
      excludeIds: { column: "id", ids: ["1", "2"] },
      orderBy: "created_at",
      limit: 500,
    });
    expect(q.text).toContain('where "status"::text = $1');
    expect(q.text).toContain('and "id"::text <> all($2)');
    expect(q.text).toContain('order by "created_at"');
    expect(q.text).toContain("limit $3");
    expect(q.values).toEqual(["new", ["1", "2"], 500]);
  });

  it("uses where, not and, when excluding with no other filter", () => {
    const q = buildSelect({ ...base, excludeIds: { column: "id", ids: ["7"] } });
    expect(q.text).toContain('where "id"::text <> all($1)');
  });

  it("caps the limit so one click cannot pull a whole database", () => {
    expect(buildSelect({ ...base, limit: 999999 }).values).toEqual([20000]);
    expect(buildSelect({ ...base, limit: 0 }).values).toEqual([1]);
  });

  it("refuses an unknown table or column", () => {
    expect(() => buildSelect({ ...base, table: "users" })).toThrow(/not in that database/);
    expect(() => buildSelect({ ...base, columns: ["password"] })).toThrow(UnknownColumnError);
  });

  it("refuses to read nothing", () => {
    expect(() => buildSelect({ ...base, columns: [] })).toThrow(/No columns/);
  });
});
