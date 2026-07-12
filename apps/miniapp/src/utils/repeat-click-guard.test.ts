import { describe, expect, it, vi } from "vitest";
import { createRepeatClickGuard } from "./repeat-click-guard";

describe("repeat click guard", () => {
  it("runs the first action and suppresses the same key within the interval", () => {
    vi.useFakeTimers();
    try {
      const guard = createRepeatClickGuard({ intervalMs: 600 });
      const action = vi.fn();

      guard.run("retry", action);
      guard.run("retry", action);
      expect(action).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(601);
      guard.run("retry", action);
      expect(action).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an async action locked while it is running and releases after failure", async () => {
    const guard = createRepeatClickGuard({ intervalMs: 600 });
    let reject!: (error: Error) => void;
    const first = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const action = vi.fn(() => first);

    guard.run("save", action);
    guard.run("save", action);
    reject(new Error("failed"));
    await first.catch(() => undefined);
    await Promise.resolve();

    guard.run("save", action);
    expect(action).toHaveBeenCalledTimes(2);
  });
});
