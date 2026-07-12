import { describe, expect, it } from "vitest";
import { formatArticleDisplayTime } from "./article-time";

describe("formatArticleDisplayTime", () => {
  const now = new Date("2026-07-12T10:30:00+08:00");

  it("formats today and yesterday with local time", () => {
    expect(formatArticleDisplayTime("2026-07-12T01:05:00+08:00", now)).toBe("今天 01:05");
    expect(formatArticleDisplayTime("2026-07-11T23:59:00+08:00", now)).toBe("昨天 23:59");
  });

  it("formats older dates and safely ignores invalid input", () => {
    expect(formatArticleDisplayTime("2026-07-10T12:00:00+08:00", now)).toBe("2026-07-10");
    expect(formatArticleDisplayTime("not-a-date", now)).toBe("");
  });
});
