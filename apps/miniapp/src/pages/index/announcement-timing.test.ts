import { describe, expect, it } from "vitest";
import { getNoticeDisplayTiming } from "./announcement-timing";

describe("notice display timing", () => {
  it("keeps configured duration when text fits", () => {
    expect(getNoticeDisplayTiming(700, 0)).toEqual({
      distancePx: 0,
      shouldScroll: false,
      scrollDurationMs: 0,
      totalDurationMs: 700
    });
  });

  it("extends duration until overflowing text can scroll fully", () => {
    const timing = getNoticeDisplayTiming(700, 240);

    expect(timing).toMatchObject({
      distancePx: 240,
      shouldScroll: true,
      scrollDurationMs: 5000
    });
    expect(timing.totalDurationMs).toBeGreaterThan(timing.scrollDurationMs);
    expect(timing.totalDurationMs).toBeGreaterThan(700);
  });
});
