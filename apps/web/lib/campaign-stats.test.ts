import { describe, expect, it } from "vitest";
import {
  byAgent,
  byDay,
  byHour,
  byStatus,
  describeRange,
  filterRows,
  humanAnsweredSet,
  matchedPreset,
  parseStatsFilters,
  statsHref,
  summarize,
  type StatRow,
  type StatusMeta,
} from "./campaign-stats";

const TODAY = "2026-09-21";

const meta: StatusMeta[] = [
  { status: "SALE", status_name: "Sale / Application started", human_answered: true, sale: true, dnc: false, not_interested: false, scheduled_callback: false, selectable: true },
  { status: "CALLBK", status_name: "Interested — callback booked", human_answered: true, sale: false, dnc: false, not_interested: false, scheduled_callback: true, selectable: true },
  { status: "NI", status_name: "Not interested", human_answered: true, sale: false, dnc: false, not_interested: true, scheduled_callback: false, selectable: true },
  { status: "DNQ", status_name: "Does not qualify", human_answered: true, sale: false, dnc: false, not_interested: false, scheduled_callback: false, selectable: true },
  { status: "A", status_name: "Answering machine", human_answered: false, sale: false, dnc: false, not_interested: false, scheduled_callback: false, selectable: false },
  { status: "NA", status_name: "No answer", human_answered: false, sale: false, dnc: false, not_interested: false, scheduled_callback: false, selectable: false },
  { status: "DROP", status_name: "Dropped call", human_answered: true, sale: false, dnc: false, not_interested: false, scheduled_callback: false, selectable: false },
];

function row(p: Partial<StatRow> & { status: string; calls: number }): StatRow {
  return {
    day: TODAY,
    hour: 10,
    agent_user: "agent1",
    talk_sec: 0,
    calls_60_plus: 0,
    calls_120_plus: 0,
    calls_300_plus: 0,
    ...p,
  };
}

describe("parseStatsFilters", () => {
  it("defaults to the last seven days and the whole clock", () => {
    expect(parseStatsFilters({}, TODAY)).toEqual({ from: "2026-09-15", to: TODAY, hourFrom: 0, hourTo: 23, agent: "" });
  });

  it("takes a preset over any dates in the address", () => {
    const f = parseStatsFilters({ preset: "today", from: "2020-01-01" }, TODAY);
    expect(f.from).toBe(TODAY);
    expect(f.to).toBe(TODAY);
  });

  it("crosses a month boundary correctly", () => {
    expect(parseStatsFilters({ preset: "30d" }, "2026-03-05").from).toBe("2026-02-04");
  });

  it("ignores dates it cannot read rather than erroring", () => {
    expect(parseStatsFilters({ from: "yesterday", to: "soon" }, TODAY).from).toBe("2026-09-15");
  });

  it("puts a backwards range the right way round", () => {
    const f = parseStatsFilters({ from: "2026-09-20", to: "2026-09-10" }, TODAY);
    expect([f.from, f.to]).toEqual(["2026-09-10", "2026-09-20"]);
  });

  it("keeps hours inside the clock, and swaps them if given backwards", () => {
    expect(parseStatsFilters({ hfrom: "9", hto: "17" }, TODAY)).toMatchObject({ hourFrom: 9, hourTo: 17 });
    expect(parseStatsFilters({ hfrom: "17", hto: "9" }, TODAY)).toMatchObject({ hourFrom: 9, hourTo: 17 });
    expect(parseStatsFilters({ hfrom: "-3", hto: "99" }, TODAY)).toMatchObject({ hourFrom: 0, hourTo: 23 });
  });

  it("keeps midnight as an hour rather than falling back", () => {
    expect(parseStatsFilters({ hfrom: "0", hto: "0" }, TODAY)).toMatchObject({ hourFrom: 0, hourTo: 0 });
  });
});

describe("matchedPreset", () => {
  it("recognises a preset range and rejects a narrowed clock", () => {
    const f = parseStatsFilters({ preset: "7d" }, TODAY);
    expect(matchedPreset(f, TODAY)).toBe("7d");
    expect(matchedPreset({ ...f, hourFrom: 9 }, TODAY)).toBeNull();
  });
});

describe("statsHref", () => {
  it("carries the range and leaves out a whole clock", () => {
    const f = parseStatsFilters({ preset: "today" }, TODAY);
    expect(statsHref("AG_AGT1", f)).toBe(`/campaigns/AG_AGT1?from=${TODAY}&to=${TODAY}`);
    expect(statsHref("AG_AGT1", f, { hourFrom: 9, hourTo: 17, agent: "agent1" })).toBe(
      `/campaigns/AG_AGT1?from=${TODAY}&to=${TODAY}&hfrom=9&hto=17&agent=agent1`,
    );
  });
});

describe("filterRows", () => {
  const rows = [row({ status: "SALE", calls: 1, hour: 8 }), row({ status: "NA", calls: 1, hour: 14 }), row({ status: "NA", calls: 1, hour: 14, agent_user: "agent2" })];

  it("keeps only the hours asked for", () => {
    expect(filterRows(rows, { from: TODAY, to: TODAY, hourFrom: 9, hourTo: 17, agent: "" })).toHaveLength(2);
  });

  it("narrows to one agent", () => {
    expect(filterRows(rows, { from: TODAY, to: TODAY, hourFrom: 0, hourTo: 23, agent: "agent2" })).toHaveLength(1);
  });
});

describe("humanAnsweredSet", () => {
  it("follows the dialer's own flag for a campaign's own outcome", () => {
    expect(humanAnsweredSet(meta).has("DNQ")).toBe(true);
  });

  it("does not count machines or unanswered calls as contact", () => {
    const set = humanAnsweredSet(meta);
    expect(set.has("A")).toBe(false);
    expect(set.has("NA")).toBe(false);
  });
});

describe("calls that never got a final outcome", () => {
  it("counts an agent's unfinished call as contact — somebody was on the line", () => {
    const s = summarize([row({ status: "INCALL", calls: 2, talk_sec: 300 })], meta);
    expect(s.contacted).toBe(2);
    expect(s.contactRate).toBeCloseTo(100);
  });

  it("does not count one the dialer was still working, with no agent on it", () => {
    const s = summarize([row({ status: "INCALL", calls: 2, agent_user: "" })], meta);
    expect(s.contacted).toBe(0);
  });

  it("applies the same rule to the hourly and daily breakdowns", () => {
    const rows = [row({ status: "DISPO", calls: 1, hour: 9 }), row({ status: "DISPO", calls: 1, hour: 9, agent_user: "" })];
    expect(byHour(rows, meta)[9]).toEqual({ hour: 9, calls: 2, contacted: 1 });
    expect(byDay(rows, meta)[0]).toMatchObject({ calls: 2, contacted: 1, connected: 1 });
  });
});

describe("summarize", () => {
  const rows = [
    row({ status: "SALE", calls: 2, talk_sec: 900, calls_120_plus: 2, calls_300_plus: 1 }),
    row({ status: "NI", calls: 3, talk_sec: 150, calls_120_plus: 0 }),
    row({ status: "CALLBK", calls: 1, talk_sec: 300, calls_120_plus: 1, calls_300_plus: 1 }),
    row({ status: "DROP", calls: 1, agent_user: "" }),
    row({ status: "A", calls: 4, agent_user: "" }),
    row({ status: "NA", calls: 9, agent_user: "" }),
  ];
  const s = summarize(rows, meta);

  it("counts calls, contacts and calls an agent took", () => {
    expect(s.calls).toBe(20);
    expect(s.contacted).toBe(7); // 2 sales + 3 not interested + 1 callback + 1 drop
    expect(s.connected).toBe(6); // the drop had no agent
  });

  it("measures contact against calls placed and pickup including machines", () => {
    expect(s.contactRate).toBeCloseTo(35);
    expect(s.pickupRate).toBeCloseTo(55);
  });

  it("counts conversations past two and five minutes", () => {
    expect(s.twoMinPlus).toBe(3);
    expect(s.fiveMinPlus).toBe(2);
    expect(s.twoMinRate).toBeCloseTo(50);
  });

  it("averages talk time over calls an agent took, not over calls placed", () => {
    expect(s.avgTalkSec).toBe(225); // 1350 seconds over 6 calls
  });

  it("measures abandons against calls a person answered", () => {
    expect(s.abandonPct).toBeCloseTo((1 / 7) * 100);
  });

  it("counts sales and booked callbacks from the dialer's flags", () => {
    expect(s.sales).toBe(2);
    expect(s.callbacks).toBe(1);
  });

  it("returns null rather than a flattering zero when nothing was dialled", () => {
    const empty = summarize([], meta);
    expect(empty.contactRate).toBeNull();
    expect(empty.abandonPct).toBeNull();
    expect(empty.avgTalkSec).toBeNull();
  });
});

describe("byStatus", () => {
  const rows = [row({ status: "NA", calls: 6, agent_user: "" }), row({ status: "SALE", calls: 2, talk_sec: 100 }), row({ status: "SALE", calls: 2, talk_sec: 100, hour: 11 })];
  const out = byStatus(rows, meta);

  it("adds up the same outcome across hours and sorts by volume", () => {
    expect(out.map((d) => [d.status, d.calls])).toEqual([
      ["NA", 6],
      ["SALE", 4],
    ]);
  });

  it("names the code and works out its share", () => {
    const sale = out.find((d) => d.status === "SALE")!;
    expect(sale.name).toBe("Sale / Application started");
    expect(sale.share).toBeCloseTo(40);
    expect(sale.tone).toBe("sale");
  });

  it("falls back to the raw code for an outcome we have no name for", () => {
    expect(byStatus([row({ status: "XYZ", calls: 1 })], meta)[0]).toMatchObject({ name: "XYZ", tone: "neutral" });
  });
});

describe("byAgent", () => {
  it("totals each agent and leaves out calls nobody took", () => {
    const rows = [
      row({ status: "SALE", calls: 2, talk_sec: 200, calls_120_plus: 1 }),
      row({ status: "NI", calls: 1, talk_sec: 50, agent_user: "agent2" }),
      row({ status: "NA", calls: 7, agent_user: "" }),
    ];
    expect(byAgent(rows, meta)).toEqual([
      { agent: "agent1", calls: 2, talkSec: 200, twoMinPlus: 1, sales: 2 },
      { agent: "agent2", calls: 1, talkSec: 50, twoMinPlus: 0, sales: 0 },
    ]);
  });
});

describe("byHour and byDay", () => {
  it("gives every hour of the clock, busy or not", () => {
    const hours = byHour([row({ status: "SALE", calls: 2, hour: 9 })], meta);
    expect(hours).toHaveLength(24);
    expect(hours[9]).toEqual({ hour: 9, calls: 2, contacted: 2 });
    expect(hours[0]).toEqual({ hour: 0, calls: 0, contacted: 0 });
  });

  it("puts days in order and separates contact from calls an agent took", () => {
    const rows = [
      row({ status: "DROP", calls: 1, day: "2026-09-20", agent_user: "" }),
      row({ status: "SALE", calls: 2, day: "2026-09-19" }),
    ];
    expect(byDay(rows, meta)).toEqual([
      { day: "2026-09-19", calls: 2, contacted: 2, connected: 2 },
      { day: "2026-09-20", calls: 1, contacted: 1, connected: 0 },
    ]);
  });
});

describe("describeRange", () => {
  it("says one day plainly and mentions the clock only when narrowed", () => {
    expect(describeRange({ from: TODAY, to: TODAY, hourFrom: 0, hourTo: 23, agent: "" })).toBe(TODAY);
    expect(describeRange({ from: "2026-09-01", to: TODAY, hourFrom: 9, hourTo: 17, agent: "" })).toBe(
      `2026-09-01 to ${TODAY}, 9:00 to 17:59`,
    );
  });
});
