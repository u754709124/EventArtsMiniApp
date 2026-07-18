import dayjs from "dayjs";
import { describe, expect, it, vi } from "vitest";
import { createCrudFormDefaults, nextSortDefaults, resolveCrudDefaultValues } from "./create-defaults";

describe("CRUD create defaults", () => {
  it("uses each existing sort field maximum plus one and ignores invalid values", () => {
    const records = [
      { sortOrder: 2, featuredSortOrder: 8 },
      { sortOrder: 7, featuredSortOrder: 3 },
      { sortOrder: -1, featuredSortOrder: "invalid" }
    ];
    expect(nextSortDefaults(records, ["sortOrder", "featuredSortOrder"])).toEqual({
      sortOrder: 8,
      featuredSortOrder: 9
    });
    expect(nextSortDefaults([], ["sortOrder", "featuredSortOrder"])).toEqual({
      sortOrder: 1,
      featuredSortOrder: 1
    });
  });

  it("evaluates dynamic defaults when a new form opens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T06:30:00.000Z"));
    try {
      const defaults = createCrudFormDefaults(
        [{ sortOrder: 4 }],
        () => ({ publishedAt: dayjs() })
      );
      expect(defaults.sortOrder).toBe(5);
      expect((defaults.publishedAt as dayjs.Dayjs).toISOString()).toBe("2026-07-18T06:30:00.000Z");
      expect(resolveCrudDefaultValues(() => ({ marker: "fresh" }))).toEqual({ marker: "fresh" });
    } finally {
      vi.useRealTimers();
    }
  });
});
