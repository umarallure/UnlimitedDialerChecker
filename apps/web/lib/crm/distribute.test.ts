import { describe, expect, it } from "vitest";
import { type Target, describeSplit, distribute, shareCounts } from "./distribute";

const agents = (...names: string[]): Target[] => names.map((owner, i) => ({ owner, listId: 400 + i }));

describe("shareCounts", () => {
  it("divides evenly when it can", () => {
    expect(shareCounts(90, agents("a", "b", "c"))).toEqual([30, 30, 30]);
  });

  it("hands the remainder out one at a time instead of piling it on the last agent", () => {
    expect(shareCounts(101, agents("a", "b", "c"))).toEqual([34, 34, 33]);
    expect(shareCounts(10, agents("a", "b", "c"))).toEqual([4, 3, 3]);
  });

  it("gives everything to a single agent", () => {
    expect(shareCounts(7, agents("a"))).toEqual([7]);
  });

  it("copes with fewer leads than agents", () => {
    expect(shareCounts(2, agents("a", "b", "c"))).toEqual([1, 1, 0]);
  });

  it("returns nothing for no leads or no agents", () => {
    expect(shareCounts(0, agents("a", "b"))).toEqual([0, 0]);
    expect(shareCounts(10, [])).toEqual([]);
  });

  it("respects weights when the split is not meant to be equal", () => {
    const weighted: Target[] = [
      { owner: "a", listId: 1, weight: 3 },
      { owner: "b", listId: 2, weight: 1 },
    ];
    expect(shareCounts(100, weighted)).toEqual([75, 25]);
    expect(shareCounts(10, weighted)).toEqual([8, 2]);
  });

  it("gives nobody anything when every weight is zero", () => {
    expect(shareCounts(10, [{ owner: "a", listId: 1, weight: 0 }])).toEqual([0]);
  });

  it("always hands out exactly the number of leads there are", () => {
    for (const total of [1, 7, 13, 99, 1000]) {
      for (const n of [1, 2, 3, 5, 7]) {
        const counts = shareCounts(total, agents(...Array.from({ length: n }, (_, i) => `a${i}`)));
        expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
});

describe("distribute", () => {
  it("deals items out in order, so each agent's batch keeps the original ordering", () => {
    const shares = distribute([1, 2, 3, 4, 5], agents("a", "b"));
    expect(shares[0].items).toEqual([1, 2, 3]);
    expect(shares[1].items).toEqual([4, 5]);
  });

  it("loses nothing and duplicates nothing", () => {
    const items = Array.from({ length: 97 }, (_, i) => i);
    const shares = distribute(items, agents("a", "b", "c", "d"));
    expect(shares.flatMap((s) => s.items).sort((x, y) => x - y)).toEqual(items);
  });

  it("gives an agent an empty batch rather than dropping them", () => {
    const shares = distribute([1], agents("a", "b"));
    expect(shares).toHaveLength(2);
    expect(shares[1].items).toEqual([]);
  });
});

describe("describeSplit", () => {
  it("reads plainly for one agent and for several", () => {
    expect(describeSplit(50, agents("agent1"))).toBe("All 50 to agent1");
    expect(describeSplit(101, agents("a", "b", "c"))).toBe("a 34 · b 34 · c 33");
    expect(describeSplit(10, [])).toBe("No one selected");
  });
});
