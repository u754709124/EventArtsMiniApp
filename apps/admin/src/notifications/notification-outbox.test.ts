// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => {
  let identity: { id: number; username: string } | null = { id: 1, username: "first" };
  return {
    getAdminIdentity: vi.fn(() => identity),
    getToken: vi.fn(() => "token"),
    persistAdminNotification: vi.fn(),
    restoreAdminIdentity: vi.fn(),
    subscribeAdminSession: vi.fn(() => () => undefined),
    setIdentity: (next: typeof identity) => {
      identity = next;
    }
  };
});

vi.mock("../api", () => api);

import { notify } from "./notification";
import { notificationOutboxTestUtils, startNotificationOutboxSync } from "./notification-outbox";

beforeEach(() => {
  localStorage.clear();
  api.setIdentity({ id: 1, username: "first" });
  api.persistAdminNotification.mockReset();
  api.persistAdminNotification.mockResolvedValue({ persisted: true, notification: {}, reason: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notification outbox", () => {
  it("persists an authenticated event and removes it after a successful idempotent sync", async () => {
    const stop = startNotificationOutboxSync();
    notify.success("保存成功");
    await vi.waitFor(() => expect(api.persistAdminNotification).toHaveBeenCalledTimes(1));
    expect(notificationOutboxTestUtils.read(1)).toEqual([]);
    stop();
  });

  it("keeps failures silently queued without recursively emitting notifications", async () => {
    api.persistAdminNotification.mockRejectedValue(new Error("offline"));
    const stop = startNotificationOutboxSync();
    notify.error("业务失败");
    await vi.waitFor(() => expect(api.persistAdminNotification).toHaveBeenCalledTimes(1));
    expect(notificationOutboxTestUtils.read(1)).toHaveLength(1);
    stop();
  });

  it("does not enqueue explicitly transient notifications", async () => {
    const stop = startNotificationOutboxSync();
    notify.error("登录失败", { persist: false });
    await Promise.resolve();
    expect(api.persistAdminNotification).not.toHaveBeenCalled();
    expect(notificationOutboxTestUtils.read(1)).toEqual([]);
    stop();
  });

  it("keeps partitions separate when administrators switch", async () => {
    api.persistAdminNotification.mockRejectedValue(new Error("offline"));
    const stop = startNotificationOutboxSync();
    notify.info("first admin");
    await vi.waitFor(() => expect(notificationOutboxTestUtils.read(1)).toHaveLength(1));

    api.setIdentity({ id: 2, username: "second" });
    notify.warning("second admin");
    await vi.waitFor(() => expect(notificationOutboxTestUtils.read(2)).toHaveLength(1));
    expect(notificationOutboxTestUtils.read(1)[0]?.message).toBe("first admin");
    expect(notificationOutboxTestUtils.read(2)[0]?.message).toBe("second admin");
    stop();
  });

  it("drops queued entries older than seven days", () => {
    notificationOutboxTestUtils.write(1, [{
      clientEventId: "4cb86b19-bdb3-4317-9dac-498fefdb6abf",
      level: "info",
      message: "expired",
      occurredAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000 - 1).toISOString()
    }]);
    expect(notificationOutboxTestUtils.read(1)).toEqual([]);
    expect(localStorage.getItem(notificationOutboxTestUtils.key(1))).toBeNull();
  });

  it("strictly discards malformed stored entries with the shared create schema", () => {
    localStorage.setItem(notificationOutboxTestUtils.key(1), JSON.stringify([
      {
        clientEventId: "not-a-uuid",
        level: "fatal",
        message: "broken",
        occurredAt: new Date().toISOString(),
        adminId: 99
      }
    ]));
    expect(notificationOutboxTestUtils.read(1)).toEqual([]);
    expect(localStorage.getItem(notificationOutboxTestUtils.key(1))).toBeNull();
  });
});
