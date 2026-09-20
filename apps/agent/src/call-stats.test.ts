import { describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { fetchCallStats, syncCallStats } from "./call-stats";

function poolReturning(rows: Record<string, unknown>[]): { pool: Pool; queries: unknown[][] } {
  const queries: unknown[][] = [];
  const pool = {
    query: async (sql: string, values: unknown[]) => {
      queries.push([sql, values]);
      return [rows, []];
    },
  } as unknown as Pool;
  return { pool, queries };
}

const row = {
  campaign_id: "AG_AGT1",
  day: new Date(Date.UTC(2026, 8, 20)),
  hour: 15,
  agent_user: "agent1",
  status: "SALE",
  calls: "3",
  talk_sec: "450",
  calls_60: "2",
  calls_120: "1",
  calls_300: "0",
};

describe("fetchCallStats", () => {
  it("reads MySQL's strings and dates as numbers and a plain day", async () => {
    const { pool, queries } = poolReturning([row]);
    const [r] = await fetchCallStats(pool, 7);

    expect(r).toEqual({
      campaignId: "AG_AGT1",
      day: "2026-09-20",
      hour: 15,
      agentUser: "agent1",
      status: "SALE",
      calls: 3,
      talkSec: 450,
      calls60Plus: 2,
      calls120Plus: 1,
      calls300Plus: 0,
    });
    expect(queries[0][1]).toEqual([7]);
  });

  it("keeps the dialer's own non-agent calls out of any agent's figures", async () => {
    const { pool } = poolReturning([{ ...row, agent_user: "" }]);
    expect((await fetchCallStats(pool, 7))[0].agentUser).toBe("");
  });
});

describe("syncCallStats", () => {
  function fakeDb() {
    const calls: string[] = [];
    const db = {
      from() {
        return {
          delete: () => ({ gte: (_col: string, day: string) => (calls.push(`delete>=${day}`), { error: null }) }),
          upsert: (rows: unknown[]) => (calls.push(`upsert:${rows.length}`), { error: null }),
        };
      },
    };
    return { db, calls };
  }

  it("clears the window before writing it, so a changed status cannot count twice", async () => {
    const { pool } = poolReturning([row, { ...row, day: new Date(Date.UTC(2026, 8, 18)), status: "NA" }]);
    const { db, calls } = fakeDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const written = await syncCallStats(db as any, pool, 7);

    expect(written).toBe(2);
    expect(calls).toEqual(["delete>=2026-09-18", "upsert:2"]);
  });

  it("does not clear anything when the dialer returned no calls", async () => {
    const { pool } = poolReturning([]);
    const { db, calls } = fakeDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await syncCallStats(db as any, pool, 7)).toBe(0);
    expect(calls).toEqual([]);
  });
});
