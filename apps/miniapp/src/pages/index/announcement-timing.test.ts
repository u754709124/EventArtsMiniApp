import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNoticeMeasurementRun,
  createNoticeViewReadyRun,
  getNextNoticeIndex,
  getNoticeDisplayTiming
} from "./announcement-timing";

afterEach(() => {
  vi.useRealTimers();
});

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

  it("keeps empty and single-item announcement lists stationary", () => {
    expect(getNextNoticeIndex(0, 0)).toBe(0);
    expect(getNextNoticeIndex(0, 1)).toBe(0);
    expect(getNextNoticeIndex(1, 2)).toBe(0);
  });
});

describe("notice measurement run", () => {
  it("accepts the first usable measurement without retrying", async () => {
    const measure = vi.fn().mockResolvedValue({ contentWidth: 320, viewportWidth: 180 });
    const run = createNoticeMeasurementRun(measure, {
      maxAttempts: 3,
      queryTimeoutMs: 50,
      retryDelayMs: 10
    });

    await expect(run.promise).resolves.toEqual({ contentWidth: 320, viewportWidth: 180 });
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("retries a temporarily unavailable native node", async () => {
    vi.useFakeTimers();
    const measure = vi.fn()
      .mockResolvedValueOnce({ contentWidth: 0, viewportWidth: 0 })
      .mockResolvedValueOnce({ contentWidth: 300, viewportWidth: 160 });
    const run = createNoticeMeasurementRun(measure, {
      maxAttempts: 3,
      queryTimeoutMs: 50,
      retryDelayMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(run.promise).resolves.toEqual({ contentWidth: 300, viewportWidth: 160 });
    expect(measure).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back after bounded retries when selector queries never return", async () => {
    vi.useFakeTimers();
    const measure = vi.fn(() => new Promise<never>(() => undefined));
    const run = createNoticeMeasurementRun(measure, {
      maxAttempts: 2,
      queryTimeoutMs: 40,
      retryDelayMs: 10
    });

    await vi.advanceTimersByTimeAsync(90);

    await expect(run.promise).resolves.toEqual({ contentWidth: 0, viewportWidth: 0 });
    expect(measure).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late result from a timed-out attempt", async () => {
    vi.useFakeTimers();
    let resolveFirst: ((value: { contentWidth: number; viewportWidth: number }) => void) | undefined;
    const firstMeasurement = new Promise<{ contentWidth: number; viewportWidth: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const measure = vi.fn()
      .mockImplementationOnce(() => firstMeasurement)
      .mockResolvedValueOnce({ contentWidth: 280, viewportWidth: 150 });
    const run = createNoticeMeasurementRun(measure, {
      maxAttempts: 2,
      queryTimeoutMs: 40,
      retryDelayMs: 10
    });

    await vi.advanceTimersByTimeAsync(50);
    const result = await run.promise;
    resolveFirst?.({ contentWidth: 999, viewportWidth: 1 });
    await Promise.resolve();

    expect(result).toEqual({ contentWidth: 280, viewportWidth: 150 });
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("cancels pending measurement timers and suppresses later retries", async () => {
    vi.useFakeTimers();
    const measure = vi.fn(() => new Promise<never>(() => undefined));
    const run = createNoticeMeasurementRun(measure, {
      maxAttempts: 3,
      queryTimeoutMs: 40,
      retryDelayMs: 10
    });
    await Promise.resolve();

    run.cancel();

    await expect(run.promise).resolves.toEqual({ contentWidth: 0, viewportWidth: 0 });
    await vi.advanceTimersByTimeAsync(200);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("notice native view readiness", () => {
  it("starts once when the native next-tick callback runs", () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const run = createNoticeViewReadyRun((callback) => callback(), start, 40);

    expect(start).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    run.cancel();
  });

  it("starts from a bounded fallback when the native callback is delayed", async () => {
    vi.useFakeTimers();
    let nativeCallback: (() => void) | undefined;
    const start = vi.fn();
    const run = createNoticeViewReadyRun((callback) => {
      nativeCallback = callback;
    }, start, 40);

    await vi.advanceTimersByTimeAsync(40);
    nativeCallback?.();

    expect(start).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    run.cancel();
  });

  it("cancels the readiness fallback before it can start measurement", async () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const run = createNoticeViewReadyRun(() => undefined, start, 40);

    run.cancel();
    await vi.advanceTimersByTimeAsync(40);

    expect(start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
