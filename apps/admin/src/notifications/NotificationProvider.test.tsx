// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider } from "./NotificationProvider";
import { notificationDurationMs, notify } from "./notification";

vi.mock("./notification-outbox", () => ({
  startNotificationOutboxSync: () => () => undefined
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NotificationProvider", () => {
  it("renders all four icon-and-text themes in a polite live region", () => {
    const { container } = render(
      <NotificationProvider>
        <div>content</div>
      </NotificationProvider>
    );

    act(() => {
      notify.success("保存成功");
      notify.error("保存失败");
      notify.warning("请检查输入");
      notify.info("处理提示");
    });

    expect(container.querySelector("[aria-live='polite']")).toBeTruthy();
    expect(screen.getAllByTestId("notification-toast")).toHaveLength(4);
    expect(screen.getByText("成功")).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.getByText("警告")).toBeTruthy();
    expect(screen.getByText("提示")).toBeTruthy();
    expect(container.querySelectorAll(".notification-toast__icon")).toHaveLength(4);
  });

  it("keeps concurrent cards stacked and removes them after the fixed five-second lifetime plus exit", () => {
    render(
      <NotificationProvider>
        <div />
      </NotificationProvider>
    );
    act(() => {
      notify.success("first");
      notify.info("second");
    });
    expect(screen.getAllByTestId("notification-toast")).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(notificationDurationMs);
    });
    expect(screen.getAllByTestId("notification-toast").every((toast) => toast.classList.contains("is-exiting"))).toBe(true);

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(screen.queryAllByTestId("notification-toast")).toHaveLength(0);
  });

  it("allows one card to be dismissed early without affecting the other cards or firing stale timers", () => {
    render(
      <NotificationProvider>
        <div />
      </NotificationProvider>
    );
    act(() => {
      notify.success("first");
      notify.info("second");
    });

    const firstToast = screen.getByText("first").closest("[data-testid='notification-toast']");
    expect(firstToast).toBeTruthy();
    const closeButton = firstToast?.querySelector<HTMLButtonElement>("[data-testid='notification-toast-close']");
    expect(closeButton?.getAttribute("aria-label")).toBe("关闭成功提示");

    fireEvent.click(closeButton!);
    fireEvent.click(closeButton!);
    expect(firstToast?.classList.contains("is-exiting")).toBe(true);
    expect(screen.getByText("second")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(screen.queryByText("first")).toBeNull();
    expect(screen.getByText("second")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(notificationDurationMs - 220);
    });
    expect(screen.queryByText("first")).toBeNull();
    expect(screen.getByText("second").closest("[data-testid='notification-toast']")?.classList.contains("is-exiting")).toBe(true);
  });
});
