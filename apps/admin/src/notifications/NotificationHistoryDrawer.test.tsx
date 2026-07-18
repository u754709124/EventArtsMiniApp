// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminNotificationDto } from "@event-arts/shared";
import { NotificationHistoryDrawer } from "./NotificationHistoryDrawer";

const api = vi.hoisted(() => ({
  listAdminNotifications: vi.fn()
}));

vi.mock("../api", () => api);

function item(id: number, level: AdminNotificationDto["level"], message: string): AdminNotificationDto {
  return {
    id,
    clientEventId: `4cb86b19-bdb3-4317-9dac-${String(id).padStart(12, "0")}`,
    level,
    message,
    occurredAt: "2026-07-17T12:00:00.000Z",
    createdAt: "2026-07-17T12:00:01.000Z"
  };
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: () => ({
      getPropertyValue: () => "",
      overflowX: "",
      overflowY: ""
    })
  });
});

beforeEach(() => {
  api.listAdminNotifications.mockReset();
});

afterEach(cleanup);

describe("NotificationHistoryDrawer", () => {
  it("requests failure logs, exposes full reasons on focus, and loads the next page", async () => {
    const longReason = "EdgeOne 预热失败：CAM 子账号缺少查询权限，请补充最小权限后重试";
    api.listAdminNotifications
      .mockResolvedValueOnce({
        items: [item(2, "error", longReason)],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 2 }
      })
      .mockResolvedValueOnce({
        items: [item(1, "error", "退出登录失败")],
        pagination: { page: 2, pageSize: 20, total: 2, totalPages: 2 }
      });

    render(<NotificationHistoryDrawer open onClose={vi.fn()} />);
    const reason = await screen.findByText(longReason);
    const row = reason.closest("article");
    expect(row?.getAttribute("aria-label")).toContain(`错误原因 ${longReason}`);
    expect(api.listAdminNotifications).toHaveBeenNthCalledWith(1, 1, 20, { level: "error" });
    fireEvent.mouseOver(row!);
    await waitFor(() => expect(screen.getAllByText(longReason).length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("退出登录失败")).toBeTruthy();
    expect(api.listAdminNotifications).toHaveBeenNthCalledWith(2, 2, 20, { level: "error" });
  });

  it("shows empty state and a retryable load error", async () => {
    api.listAdminNotifications
      .mockRejectedValueOnce(new Error("服务不可用"))
      .mockResolvedValueOnce({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
      });
    render(<NotificationHistoryDrawer open onClose={vi.fn()} />);
    expect((await screen.findByTestId("notification-history-error")).textContent).toContain("服务不可用");
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await waitFor(() => expect(api.listAdminNotifications).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("最近 7 天暂无失败日志")).toBeTruthy();
  });

  it("clears only visible logs and reloads server history after reopening", async () => {
    api.listAdminNotifications.mockResolvedValue({
      items: [item(1, "error", "服务端仍保留的失败日志")],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
    });
    const view = render(<NotificationHistoryDrawer open onClose={vi.fn()} />);

    expect(await screen.findByText("服务端仍保留的失败日志")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清空界面日志" }));
    expect(await screen.findByText("最近 7 天暂无失败日志")).toBeTruthy();
    expect(api.listAdminNotifications).toHaveBeenCalledTimes(1);

    view.rerender(<NotificationHistoryDrawer open={false} onClose={vi.fn()} />);
    view.rerender(<NotificationHistoryDrawer open onClose={vi.fn()} />);
    expect(await screen.findByText("服务端仍保留的失败日志")).toBeTruthy();
    expect(api.listAdminNotifications).toHaveBeenCalledTimes(2);
  });
});
