import type { AdminNotificationLevel } from "@event-arts/shared";

export const notificationDurationMs = 5_000;

export type NotificationEvent = {
  id: string;
  clientEventId: string;
  level: AdminNotificationLevel;
  message: string;
  occurredAt: string;
  persist: boolean;
};

const listeners = new Set<(event: NotificationEvent) => void>();

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else bytes.forEach((_, index) => {
    bytes[index] = Math.floor(Math.random() * 256);
  });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type NotificationOptions = { persist?: boolean };

function show(level: AdminNotificationLevel, message: string, options: NotificationOptions = {}) {
  const clientEventId = uuid();
  const event: NotificationEvent = {
    id: clientEventId,
    clientEventId,
    level,
    message: String(message),
    occurredAt: new Date().toISOString(),
    persist: options.persist !== false
  };
  listeners.forEach((listener) => listener(event));
}

export const notify = {
  success: (message: string, options?: NotificationOptions) => show("success", message, options),
  error: (message: string, options?: NotificationOptions) => show("error", message, options),
  warning: (message: string, options?: NotificationOptions) => show("warning", message, options),
  info: (message: string, options?: NotificationOptions) => show("info", message, options)
};

export function subscribeNotifications(listener: (event: NotificationEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
