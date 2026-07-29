import { describe, expect, it } from "vitest";
import {
  artistWaterfallGap,
  buildArtistWaterfallColumns,
  estimateArtistCardHeight
} from "./artist-waterfall";

type Item = {
  id: number;
  tags?: string[];
  summary?: string;
};

describe("artist waterfall", () => {
  it("keeps empty input empty and alternates equal-height cards deterministically", () => {
    expect(buildArtistWaterfallColumns<Item>([])).toEqual({ left: [], right: [] });
    const items = [1, 2, 3, 4].map((id) => ({ id }));
    const columns = buildArtistWaterfallColumns(items);
    expect(columns.left.map((item) => item.id)).toEqual([1, 3]);
    expect(columns.right.map((item) => item.id)).toEqual([2, 4]);
  });

  it("assigns the next card to the shorter estimated column and keeps every item once", () => {
    const items: Item[] = [
      { id: 1, tags: ["主持"], summary: "两行描述" },
      { id: 2 },
      { id: 3 },
      { id: 4, tags: ["晚宴"] }
    ];
    const columns = buildArtistWaterfallColumns(items);
    expect(columns.left.map((item) => item.id)).toEqual([1, 4]);
    expect(columns.right.map((item) => item.id)).toEqual([2, 3]);
    expect([...columns.left, ...columns.right].map((item) => item.id).sort()).toEqual([1, 2, 3, 4]);
    expect(estimateArtistCardHeight(items[0])).toBeGreaterThan(estimateArtistCardHeight(items[1]));
    expect(artistWaterfallGap).toBe(18);
  });
});
