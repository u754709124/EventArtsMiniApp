import {
  adminNotificationCreateRequestSchema,
  type AdminNotificationCreateRequest
} from "@event-arts/shared";
import {
  getAdminIdentity,
  getToken,
  persistAdminNotification,
  restoreAdminIdentity,
  subscribeAdminSession
} from "../api";
import { subscribeNotifications, type NotificationEvent } from "./notification";

const retentionMs = 7 * 24 * 60 * 60 * 1_000;
const keyPrefix = "eventarts.admin.notification-outbox.v1.";
const flushing = new Set<number>();

function key(adminId: number) {
  return `${keyPrefix}${adminId}`;
}

function read(adminId: number): AdminNotificationCreateRequest[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(adminId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - retentionMs;
    const retained = parsed.flatMap((item) => {
      const result = adminNotificationCreateRequestSchema.safeParse(item);
      if (!result.success || new Date(result.data.occurredAt).getTime() < cutoff) return [];
      return [result.data];
    });
    if (retained.length !== parsed.length) write(adminId, retained);
    return retained;
  } catch {
    return [];
  }
}

function write(adminId: number, items: AdminNotificationCreateRequest[]) {
  try {
    if (items.length) localStorage.setItem(key(adminId), JSON.stringify(items));
    else localStorage.removeItem(key(adminId));
  } catch {
    // Persistence failures must not create another notification.
  }
}

function enqueue(event: NotificationEvent) {
  if (!event.persist) return;
  const identity = getAdminIdentity();
  if (!identity) return;
  const items = read(identity.id);
  if (!items.some((item) => item.clientEventId === event.clientEventId)) {
    items.push({
      clientEventId: event.clientEventId,
      level: event.level,
      message: event.message,
      occurredAt: event.occurredAt
    });
    write(identity.id, items);
  }
  void flush(identity.id);
}

export async function flush(adminId: number) {
  if (flushing.has(adminId)) return;
  const identity = getAdminIdentity();
  if (!identity || identity.id !== adminId || !getToken()) return;
  flushing.add(adminId);
  try {
    for (const item of read(adminId)) {
      const current = getAdminIdentity();
      if (!current || current.id !== adminId || !getToken()) return;
      try {
        await persistAdminNotification(item);
      } catch {
        return;
      }
      write(adminId, read(adminId).filter((queued) => queued.clientEventId !== item.clientEventId));
    }
  } finally {
    flushing.delete(adminId);
  }
}

export function startNotificationOutboxSync() {
  const stopNotifications = subscribeNotifications(enqueue);
  const stopSession = subscribeAdminSession((identity) => {
    if (identity) void flush(identity.id);
  });
  const syncCurrent = () => {
    const identity = getAdminIdentity();
    if (identity) void flush(identity.id);
  };
  window.addEventListener("online", syncCurrent);
  window.addEventListener("storage", syncCurrent);

  const identity = getAdminIdentity();
  if (identity) {
    void flush(identity.id);
  } else if (getToken()) {
    void restoreAdminIdentity().catch(() => undefined);
  }

  return () => {
    stopNotifications();
    stopSession();
    window.removeEventListener("online", syncCurrent);
    window.removeEventListener("storage", syncCurrent);
  };
}

export const notificationOutboxTestUtils = { key, read, write };
