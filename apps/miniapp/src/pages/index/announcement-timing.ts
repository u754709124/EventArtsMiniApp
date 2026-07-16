const defaultNoticeDurationMs = 3000;
const marqueeStartPauseMs = 500;
const marqueeEndPauseMs = 700;
const marqueeSpeedPxPerSecond = 48;
const marqueeMinScrollMs = 900;
const noticeMeasurementMaxAttempts = 3;
const noticeMeasurementQueryTimeoutMs = 160;
const noticeMeasurementRetryDelayMs = 80;
const noticeViewReadyFallbackMs = 160;

export type NoticeMeasurement = {
  contentWidth: number;
  viewportWidth: number;
};

export type NoticeMeasurementRun = {
  cancel: () => void;
  promise: Promise<NoticeMeasurement>;
};

export type NoticeViewReadyRun = {
  cancel: () => void;
};

type NoticeMeasurementRunOptions = {
  maxAttempts?: number;
  queryTimeoutMs?: number;
  retryDelayMs?: number;
};

export type NoticeDisplayTiming = {
  distancePx: number;
  shouldScroll: boolean;
  scrollDurationMs: number;
  totalDurationMs: number;
};

const emptyNoticeMeasurement: NoticeMeasurement = {
  contentWidth: 0,
  viewportWidth: 0
};

function normalizeNoticeMeasurement(measurement: NoticeMeasurement): NoticeMeasurement {
  return {
    contentWidth: Number.isFinite(measurement.contentWidth) && measurement.contentWidth > 0
      ? measurement.contentWidth
      : 0,
    viewportWidth: Number.isFinite(measurement.viewportWidth) && measurement.viewportWidth > 0
      ? measurement.viewportWidth
      : 0
  };
}

function hasUsableNoticeMeasurement(measurement: NoticeMeasurement) {
  return measurement.contentWidth > 0 && measurement.viewportWidth > 0;
}

export function createNoticeViewReadyRun(
  scheduleNativeViewReady: (callback: () => void) => void,
  start: () => void,
  fallbackDelayMs = noticeViewReadyFallbackMs
): NoticeViewReadyRun {
  let cancelled = false;
  let started = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  function startOnce() {
    if (cancelled || started) return;
    started = true;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
    start();
  }

  fallbackTimer = setTimeout(startOnce, Math.max(0, fallbackDelayMs));
  try {
    scheduleNativeViewReady(startOnce);
  } catch {
    startOnce();
  }

  return {
    cancel() {
      cancelled = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }
    }
  };
}

export function createNoticeMeasurementRun(
  measure: () => Promise<NoticeMeasurement>,
  options: NoticeMeasurementRunOptions = {}
): NoticeMeasurementRun {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? noticeMeasurementMaxAttempts));
  const queryTimeoutMs = Math.max(0, options.queryTimeoutMs ?? noticeMeasurementQueryTimeoutMs);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? noticeMeasurementRetryDelayMs);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let cancelled = false;
  let settled = false;
  let resolveRun: (measurement: NoticeMeasurement) => void = () => undefined;

  const promise = new Promise<NoticeMeasurement>((resolve) => {
    resolveRun = resolve;
  });

  function clearTimer(timer: ReturnType<typeof setTimeout>) {
    clearTimeout(timer);
    timers.delete(timer);
  }

  function schedule(callback: () => void, delayMs: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
    return timer;
  }

  function finish(measurement: NoticeMeasurement) {
    if (settled) return;
    settled = true;
    timers.forEach(clearTimeout);
    timers.clear();
    resolveRun(normalizeNoticeMeasurement(measurement));
  }

  function runAttempt(attempt: number) {
    if (cancelled) {
      finish(emptyNoticeMeasurement);
      return;
    }

    let attemptSettled = false;
    const queryTimer = schedule(() => completeAttempt(emptyNoticeMeasurement), queryTimeoutMs);

    function completeAttempt(measurement: NoticeMeasurement) {
      if (attemptSettled || settled || cancelled) return;
      attemptSettled = true;
      clearTimer(queryTimer);
      const normalized = normalizeNoticeMeasurement(measurement);

      if (hasUsableNoticeMeasurement(normalized) || attempt >= maxAttempts) {
        finish(normalized);
        return;
      }

      schedule(() => runAttempt(attempt + 1), retryDelayMs);
    }

    void Promise.resolve()
      .then(measure)
      .then(completeAttempt, () => completeAttempt(emptyNoticeMeasurement));
  }

  runAttempt(1);

  return {
    cancel() {
      if (settled) return;
      cancelled = true;
      finish(emptyNoticeMeasurement);
    },
    promise
  };
}

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

export function getNextNoticeIndex(current: number, announcementCount: number) {
  if (announcementCount <= 1) return 0;
  return (Math.max(0, current) + 1) % announcementCount;
}

export function getNoticeMarqueeStartPauseMs() {
  return marqueeStartPauseMs;
}
