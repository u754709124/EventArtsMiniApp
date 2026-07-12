import { useCallback, useRef } from "react";

type GuardAction<T> = () => T | Promise<T>;

export type RepeatClickGuardOptions = {
  intervalMs?: number;
};

export const defaultRepeatClickIntervalMs = 600;

export function createRepeatClickGuard(options: RepeatClickGuardOptions = {}) {
  const intervalMs = options.intervalMs ?? defaultRepeatClickIntervalMs;
  const lockedUntil = new Map<string, number>();
  const running = new Set<string>();

  function run<T>(key: string, action: GuardAction<T>) {
    const now = Date.now();
    if (running.has(key) || (lockedUntil.get(key) ?? 0) > now) return undefined;

    lockedUntil.set(key, now + intervalMs);
    let result: T | Promise<T>;
    try {
      result = action();
    } catch (error) {
      lockedUntil.delete(key);
      throw error;
    }

    if (result && typeof (result as Promise<T>).finally === "function") {
      running.add(key);
      void (result as Promise<T>).finally(() => {
        running.delete(key);
        lockedUntil.delete(key);
      });
    }

    return result;
  }

  return { run };
}

const globalRepeatClickGuard = createRepeatClickGuard();

export function runGuardedAction<T>(key: string, action: GuardAction<T>) {
  return globalRepeatClickGuard.run(key, action);
}

export function useRepeatClickGuard(options?: RepeatClickGuardOptions) {
  const guardRef = useRef<ReturnType<typeof createRepeatClickGuard> | null>(null);
  if (!guardRef.current) guardRef.current = createRepeatClickGuard(options);
  return useCallback(<T,>(key: string, action: GuardAction<T>) => guardRef.current!.run(key, action), []);
}
