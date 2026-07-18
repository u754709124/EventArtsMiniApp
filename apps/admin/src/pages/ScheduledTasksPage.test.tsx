// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal } from "antd";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTaskDto, ScheduledTaskListResponse } from "@event-arts/shared";
import { ScheduledTasksPage, formatBeijingTime } from "./ScheduledTasksPage";

const apiMocks = vi.hoisted(() => ({
  listScheduledTasks: vi.fn(),
  runScheduledTask: vi.fn()
}));
const notifyMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}));

vi.mock("../api", () => apiMocks);
vi.mock("../notifications/notification", () => ({ notify: notifyMocks }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function task(overrides: Partial<ScheduledTaskDto> = {}): ScheduledTaskDto {
  return {
    taskKey: "admin-session-cleanup",
    name: "管理员会话清理",
    description: "删除已过期的后台管理员登录会话。",
    cron: "2 * * * *",
    timezone: "Asia/Shanghai",
    nextExecutionAt: "2026-07-18T01:02:00.000Z",
    lastExecutionAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    isRunning: false,
    resultSummary: null,
    ...overrides
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
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, "getComputedStyle", {
    value: () => ({ getPropertyValue: () => "" })
  });
});

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  Object.values(notifyMocks).forEach((mock) => mock.mockReset());
});

afterEach(() => {
  Modal.destroyAll();
  cleanup();
});

describe("ScheduledTasksPage", () => {
  it("shows loading, empty, and retryable error states", async () => {
    const pending = deferred<ScheduledTaskListResponse>();
    apiMocks.listScheduledTasks.mockReturnValueOnce(pending.promise);
    render(<ScheduledTasksPage />);
    expect(screen.getByTestId("scheduled-tasks-loading")).toBeTruthy();
    pending.resolve({ items: [] });
    await screen.findByText("暂无定时任务");

    cleanup();
    apiMocks.listScheduledTasks.mockReset();
    apiMocks.listScheduledTasks
      .mockRejectedValueOnce(new Error("服务不可用"))
      .mockResolvedValueOnce({ items: [] });
    render(<ScheduledTasksPage />);
    await screen.findByTestId("scheduled-tasks-error");
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await waitFor(() => expect(apiMocks.listScheduledTasks).toHaveBeenCalledTimes(2));
  });

  it("renders required fields and formats times in Asia/Shanghai", async () => {
    apiMocks.listScheduledTasks.mockResolvedValue({
      items: [
        task(),
        task({
          taskKey: "analytics-cleanup",
          name: "访问统计清理",
          description: "删除超过保留期的访问统计数据。",
          cron: "20 3 * * *",
          lastExecutionAt: "2026-07-17T19:20:00.000Z",
          lastStatus: "success"
        })
      ]
    });
    render(<ScheduledTasksPage />);

    expect(await screen.findByText("服务器会按北京时间自动调度；这里展示真实执行状态，也可在确认后立即执行。")).toBeTruthy();
    await screen.findByText("管理员会话清理");
    expect(screen.getByText("删除已过期的后台管理员登录会话。")).toBeTruthy();
    expect(screen.getByText("2 * * * *")).toBeTruthy();
    expect(screen.getAllByText("2026-07-18 09:02:00").length).toBeGreaterThan(0);
    expect(screen.getByText("从未执行")).toBeTruthy();
    expect(screen.getByText("2026-07-18 03:20:00")).toBeTruthy();
    expect(formatBeijingTime(null)).toBe("从未执行");
  });

  it("confirms once, disables the running row, and refreshes after success", async () => {
    const run = deferred<Awaited<ReturnType<typeof apiMocks.runScheduledTask>>>();
    apiMocks.listScheduledTasks
      .mockResolvedValueOnce({ items: [task()] })
      .mockResolvedValue({ items: [task({ lastStatus: "success" })] });
    apiMocks.runScheduledTask.mockReturnValue(run.promise);

    render(<ScheduledTasksPage />);
    fireEvent.click(await screen.findByTestId("scheduled-task-run-admin-session-cleanup"));
    const dialog = await screen.findByRole("dialog", { name: "立即执行“管理员会话清理”？" });
    const confirm = within(dialog).getByRole("button", { name: /立\s*即\s*执\s*行/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(apiMocks.runScheduledTask).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("scheduled-task-run-admin-session-cleanup").hasAttribute("disabled")).toBe(true);
    run.resolve({
      taskKey: "admin-session-cleanup",
      status: "success",
      startedAt: "2026-07-18T01:00:00.000Z",
      finishedAt: "2026-07-18T01:00:01.000Z",
      resultSummary: { deletedCount: 1 }
    });
    await waitFor(() => expect(apiMocks.listScheduledTasks).toHaveBeenCalledTimes(2));
    expect(notifyMocks.success).toHaveBeenCalledWith("管理员会话清理执行成功");
  });

  it("reports a busy failure and still refreshes the list", async () => {
    apiMocks.listScheduledTasks.mockResolvedValue({ items: [task()] });
    const error = Object.assign(new Error("busy"), { code: "SCHEDULED_TASK_BUSY" });
    apiMocks.runScheduledTask.mockRejectedValue(error);
    render(<ScheduledTasksPage />);

    fireEvent.click(await screen.findByTestId("scheduled-task-run-admin-session-cleanup"));
    const dialog = await screen.findByRole("dialog", { name: "立即执行“管理员会话清理”？" });
    fireEvent.click(within(dialog).getByRole("button", { name: /立\s*即\s*执\s*行/ }));

    await waitFor(() => expect(notifyMocks.error).toHaveBeenCalledWith("任务正在执行，请稍后再试"));
    await waitFor(() => expect(apiMocks.listScheduledTasks).toHaveBeenCalledTimes(2));
  });
});
