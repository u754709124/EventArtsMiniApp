const defaultNoticeDurationMs = 3000;
const marqueeStartPauseMs = 500;
const marqueeEndPauseMs = 700;
const marqueeSpeedPxPerSecond = 48;
const marqueeMinScrollMs = 900;

export type NoticeDisplayTiming = {
  distancePx: number;
  shouldScroll: boolean;
  scrollDurationMs: number;
  totalDurationMs: number;
};

export function getNoticeDisplayTiming(displayDurationMs: number | null | undefined, overflowDistancePx: number): NoticeDisplayTiming {
  const baseDuration = displayDurationMs && displayDurationMs > 0 ? displayDurationMs : defaultNoticeDurationMs;
  const distancePx = Math.max(0, Math.ceil(overflowDistancePx));

  if (distancePx === 0) {
    return {
      distancePx: 0,
      shouldScroll: false,
      scrollDurationMs: 0,
      totalDurationMs: baseDuration
    };
  }

  const scrollDurationMs = Math.max(
    marqueeMinScrollMs,
    Math.ceil((distancePx / marqueeSpeedPxPerSecond) * 1000)
  );
  const marqueeDurationMs = marqueeStartPauseMs + scrollDurationMs + marqueeEndPauseMs;

  return {
    distancePx,
    shouldScroll: true,
    scrollDurationMs,
    totalDurationMs: Math.max(baseDuration, marqueeDurationMs)
  };
}

export function getNoticeMarqueeStartPauseMs() {
  return marqueeStartPauseMs;
}
