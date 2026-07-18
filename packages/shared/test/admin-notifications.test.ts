import { describe, expect, it } from "vitest";
import {
  adminNotificationCreateRequestSchema,
  adminNotificationLevelValues,
  adminNotificationListQuerySchema,
  adminNotificationLimits
} from "../src";

describe("admin notification contracts", () => {
  it.each(adminNotificationLevelValues)("accepts the %s level", (level) => {
    expect(adminNotificationCreateRequestSchema.parse({
      clientEventId: "4cb86b19-bdb3-4317-9dac-498fefdb6abf",
      level,
      message: " 操作完成 ",
      occurredAt: "2026-07-17T12:00:00.000Z"
    })).toEqual({
      clientEventId: "4cb86b19-bdb3-4317-9dac-498fefdb6abf",
      level,
      message: "操作完成",
      occurredAt: "2026-07-17T12:00:00.000Z"
    });
  });

  it("rejects unknown fields, invalid timestamps, and oversized messages", () => {
    const base = {
      clientEventId: "4cb86b19-bdb3-4317-9dac-498fefdb6abf",
      level: "success",
      message: "操作完成",
      occurredAt: "2026-07-17T12:00:00.000Z"
    };
    expect(adminNotificationCreateRequestSchema.safeParse({ ...base, adminId: 1 }).success).toBe(false);
    expect(adminNotificationCreateRequestSchema.safeParse({ ...base, occurredAt: "yesterday" }).success).toBe(false);
    expect(adminNotificationCreateRequestSchema.safeParse({
      ...base,
      message: "x".repeat(adminNotificationLimits.messageMaxLength + 1)
    }).success).toBe(false);
  });

  it("coerces and bounds pagination", () => {
    expect(adminNotificationListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(adminNotificationListQuerySchema.parse({ page: "2", pageSize: "100", level: "error" })).toEqual({
      page: 2,
      pageSize: 100,
      level: "error"
    });
    expect(adminNotificationListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(adminNotificationListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(adminNotificationListQuerySchema.safeParse({ level: "fatal" }).success).toBe(false);
  });
});
