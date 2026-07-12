import { describe, expect, it, vi } from "vitest";
import { createRepeatClickGuard } from "./repeat-click-guard";

describe("repeat click guard", () => {
  it("suppresses only the same control key", () => {
    vi.useFakeTimers();
    try {
      const guard = createRepeatClickGuard({ intervalMs: 600 });
      const left = vi.fn();
      const right = vi.fn();

      guard.run("delete:1", left);
      guard.run("delete:1", left);
      guard.run("delete:2", right);
      expect(left).toHaveBeenCalledTimes(1);
      expect(right).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases an async action after it settles", async () => {
    const guard = createRepeatClickGuard({ intervalMs: 600 });
    let resolve!: () => void;
    const pending = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const action = vi.fn(() => pending);

    guard.run("upload", action);
    guard.run("upload", action);
    resolve();
    await pending;
    await Promise.resolve();

    guard.run("upload", action);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("releases an async action after failure", async () => {
    const guard = createRepeatClickGuard({ intervalMs: 600 });
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const action = vi.fn(() => pending);

    const returned = guard.run("delete", action) as Promise<void>;
    guard.run("delete", action);
    reject(new Error("failed"));
    await returned.catch(() => undefined);
    await Promise.resolve();

    guard.run("delete", action);
    expect(action).toHaveBeenCalledTimes(2);
  });
});
