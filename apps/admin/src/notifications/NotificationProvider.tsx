import {
  CheckCircleFilled,
  CloseOutlined,
  CloseCircleFilled,
  InfoCircleFilled,
  WarningFilled
} from "@ant-design/icons";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AdminNotificationLevel } from "@event-arts/shared";
import { notificationDurationMs, subscribeNotifications, type NotificationEvent } from "./notification";
import { startNotificationOutboxSync } from "./notification-outbox";
import "./notifications.css";

type Toast = NotificationEvent & { state: "entering" | "visible" | "exiting" };
type ToastTimers = { frame?: number; exit?: number; remove?: number };

const labels: Record<AdminNotificationLevel, string> = {
  success: "成功",
  error: "失败",
  warning: "警告",
  info: "提示"
};

const icons: Record<AdminNotificationLevel, ReactNode> = {
  success: <CheckCircleFilled />,
  error: <CloseCircleFilled />,
  warning: <WarningFilled />,
  info: <InfoCircleFilled />
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const previousPositions = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ToastTimers>());
  const exitingToasts = useRef(new Set<string>());

  const clearToastTimers = useCallback((id: string) => {
    const scheduled = timers.current.get(id);
    if (!scheduled) return;
    if (scheduled.frame !== undefined) window.cancelAnimationFrame(scheduled.frame);
    if (scheduled.exit !== undefined) window.clearTimeout(scheduled.exit);
    if (scheduled.remove !== undefined) window.clearTimeout(scheduled.remove);
    timers.current.delete(id);
  }, []);

  const removeToast = useCallback((id: string) => {
    clearToastTimers(id);
    exitingToasts.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, [clearToastTimers]);

  const dismissToast = useCallback((id: string) => {
    if (exitingToasts.current.has(id)) return;
    exitingToasts.current.add(id);
    clearToastTimers(id);
    setToasts((current) => current.map((item) => item.id === id ? { ...item, state: "exiting" } : item));
    const remove = window.setTimeout(() => removeToast(id), 220);
    timers.current.set(id, { remove });
  }, [clearToastTimers, removeToast]);

  useEffect(() => {
    const stopOutbox = startNotificationOutboxSync();
    const stopToasts = subscribeNotifications((event) => {
      setToasts((current) => [...current, { ...event, state: "entering" }]);
      const enter = window.requestAnimationFrame(() => {
        setToasts((current) => current.map((item) => item.id === event.id ? { ...item, state: "visible" } : item));
      });
      const exit = window.setTimeout(() => {
        exitingToasts.current.add(event.id);
        setToasts((current) => current.map((item) => item.id === event.id ? { ...item, state: "exiting" } : item));
      }, notificationDurationMs);
      const remove = window.setTimeout(() => removeToast(event.id), notificationDurationMs + 220);
      timers.current.set(event.id, { frame: enter, exit, remove });
    });
    return () => {
      stopToasts();
      stopOutbox();
      [...timers.current.keys()].forEach(clearToastTimers);
      exitingToasts.current.clear();
    };
  }, [clearToastTimers, removeToast]);

  useLayoutEffect(() => {
    const next = new Map<string, number>();
    nodes.current.forEach((node, id) => {
      const top = node.getBoundingClientRect().top;
      next.set(id, top);
      const previous = previousPositions.current.get(id);
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      if (previous !== undefined && previous !== top && !reducedMotion && typeof node.animate === "function") {
        node.animate(
          [{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }],
          { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
        );
      }
    });
    previousPositions.current = next;
  }, [toasts]);

  return (
    <>
      {children}
      <section className="notification-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div
            className="notification-toast-position"
            key={toast.id}
            ref={(node) => {
              if (node) nodes.current.set(toast.id, node);
              else nodes.current.delete(toast.id);
            }}
          >
            <div
              className={`notification-toast notification-toast--${toast.level} is-${toast.state}`}
              data-testid="notification-toast"
              data-level={toast.level}
              role="status"
            >
              <button
                aria-label={`关闭${labels[toast.level]}提示`}
                className="notification-toast__close"
                data-testid="notification-toast-close"
                onClick={() => dismissToast(toast.id)}
                type="button"
              >
                <CloseOutlined aria-hidden="true" />
              </button>
              <div className="notification-toast__progress" aria-hidden="true" />
              <span className="notification-toast__icon" aria-hidden="true">{icons[toast.level]}</span>
              <div className="notification-toast__content">
                <strong>{labels[toast.level]}</strong>
                <span>{toast.message}</span>
              </div>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
