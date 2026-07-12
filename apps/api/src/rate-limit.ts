export type RateLimitClock = () => Date;

export type FixedWindowRateLimitPolicy = {
  windowMs: number;
  limit: number;
};

export type RateLimitBucket = {
  count: number;
  resetAtMs: number;
};

export type RateLimitStore = {
  get: (key: string) => RateLimitBucket | null | Promise<RateLimitBucket | null>;
  set: (key: string, bucket: RateLimitBucket) => void | Promise<void>;
  delete: (key: string) => void | Promise<void>;
};

export type RateLimitAllowed = {
  allowed: true;
  remaining: number;
  resetAt: Date;
};

export type RateLimitDenied = {
  allowed: false;
  retryAfterSeconds: number;
  resetAt: Date;
};

export type RateLimitDecision = RateLimitAllowed | RateLimitDenied;

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitBucket>();

  get(key: string) {
    const bucket = this.buckets.get(key);
    return bucket ? { ...bucket } : null;
  }

  set(key: string, bucket: RateLimitBucket) {
    this.buckets.set(key, { ...bucket });
  }

  delete(key: string) {
    this.buckets.delete(key);
  }
}

export function createInMemoryRateLimitStore() {
  return new InMemoryRateLimitStore();
}

function retryAfterSeconds(nowMs: number, resetAtMs: number) {
  return Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
}

function allowedDecision(policy: FixedWindowRateLimitPolicy, count: number, resetAtMs: number): RateLimitAllowed {
  return {
    allowed: true,
    remaining: Math.max(0, policy.limit - count),
    resetAt: new Date(resetAtMs)
  };
}

function deniedDecision(nowMs: number, resetAtMs: number): RateLimitDenied {
  return {
    allowed: false,
    retryAfterSeconds: retryAfterSeconds(nowMs, resetAtMs),
    resetAt: new Date(resetAtMs)
  };
}

export class FixedWindowRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly clock: RateLimitClock
  ) {}

  async peek(key: string, policy: FixedWindowRateLimitPolicy): Promise<RateLimitDecision> {
    const nowMs = this.clock().getTime();
    const bucket = await this.store.get(key);
    if (!bucket || bucket.resetAtMs <= nowMs) {
      return allowedDecision(policy, 0, nowMs + policy.windowMs);
    }
    if (bucket.count >= policy.limit) {
      return deniedDecision(nowMs, bucket.resetAtMs);
    }
    return allowedDecision(policy, bucket.count, bucket.resetAtMs);
  }

  async consume(key: string, policy: FixedWindowRateLimitPolicy): Promise<RateLimitDecision> {
    const nowMs = this.clock().getTime();
    const bucket = await this.store.get(key);
    if (!bucket || bucket.resetAtMs <= nowMs) {
      const nextBucket = { count: 1, resetAtMs: nowMs + policy.windowMs };
      await this.store.set(key, nextBucket);
      return allowedDecision(policy, nextBucket.count, nextBucket.resetAtMs);
    }
    if (bucket.count >= policy.limit) {
      return deniedDecision(nowMs, bucket.resetAtMs);
    }

    const nextBucket = { count: bucket.count + 1, resetAtMs: bucket.resetAtMs };
    await this.store.set(key, nextBucket);
    return allowedDecision(policy, nextBucket.count, nextBucket.resetAtMs);
  }

  async reset(key: string) {
    await this.store.delete(key);
  }
}

export function normalizeRateLimitUsername(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function normalizeClientIp(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || "unknown";
}

export function loginRateLimitKey(input: { clientIp: string; username: string }) {
  return `login:${JSON.stringify([normalizeClientIp(input.clientIp), normalizeRateLimitUsername(input.username)])}`;
}

export function analyticsRateLimitKey(clientIp: string) {
  return `analytics:${JSON.stringify([normalizeClientIp(clientIp)])}`;
}
