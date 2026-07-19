// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardOverviewResponse } from "@event-arts/shared";
import { DashboardPage } from "./DashboardPage";

const apiMocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../api", () => apiMocks);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function readyOverview(seed = 1): DashboardOverviewResponse {
  return {
    todayUniqueUsers: seed,
    weekDailyUniqueUsers: seed + 1,
    monthDailyUniqueUsers: seed + 2,
    edgeOne: {
      status: "ready",
      zoneId: "zone-demo",
      fetchedAt: "2026-07-16T08:00:00.000Z",
      last24Hours: {
        startTime: "2026-07-15T08:00:00.000Z",
        endTime: "2026-07-16T08:00:00.000Z",
        trafficBytes: seed * 1_000_000_000,
        requestCount: seed * 1_000_000
      },
      package: {
        planId: "plan-demo",
        planType: "prepaid",
        planStatus: "normal",
        periodStart: "2026-07-01T00:00:00.000+08:00",
        periodEnd: "2026-08-01T00:00:00.000+08:00",
        trafficUsedBytes: seed * 2_000_000_000,
        trafficCapacityBytes: seed * 10_000_000_000,
        requestUsed: seed * 3_000_000,
        requestCapacity: seed * 20_000_000
      }
    }
  };
}

function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/system-config" element={<div>系统配置目标页</div>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>
  );
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
});

beforeEach(() => {
  apiMocks.request.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("DashboardPage", () => {
  it("renders the three local cards and four EdgeOne cards with the billing delay notice", async () => {
    apiMocks.request.mockResolvedValueOnce(readyOverview(2));

    renderPage();

    await waitFor(() => expect(screen.getByTestId("dashboard-pv-today").textContent).toContain("2"));
    expect(screen.getByTestId("dashboard-pv-week").textContent).toContain("3");
    expect(screen.getByTestId("dashboard-pv-month").textContent).toContain("4");
    expect(screen.getByTestId("dashboard-edgeone-last24-traffic").textContent).toContain("2.00 GB");
    expect(screen.getByTestId("dashboard-edgeone-last24-requests").textContent).toContain("2.00 M");
    expect(screen.getByTestId("dashboard-edgeone-package-traffic").textContent).toContain("4.00 GB / 20.00 GB");
    expect(screen.getByTestId("dashboard-edgeone-package-requests").textContent).toContain("6.00 M / 40.00 M");
    expect(screen.getByLabelText("EdgeOne 配置信息").textContent).toContain("Zone zone-demo");
    expect(screen.getByLabelText("EdgeOne 配置信息").textContent).toContain("套餐 plan-demo");
    expect(screen.getByText("官方计费数据可能延迟约 3 小时")).toBeTruthy();
    expect(screen.getByText(/最近成功刷新/).textContent).toContain("北京时间");
  });

  it("adapts recent and package traffic and request units independently", async () => {
    const overview = readyOverview(1);
    if (overview.edgeOne.status !== "ready") throw new Error("测试数据必须为 ready");
    overview.edgeOne.last24Hours.trafficBytes = 999_000_000;
    overview.edgeOne.last24Hours.requestCount = 999;
    overview.edgeOne.package.trafficUsedBytes = 500_000_000;
    overview.edgeOne.package.requestUsed = 500;
    apiMocks.request.mockResolvedValueOnce(overview);

    renderPage();

    expect(await screen.findByLabelText("999.00 MB")).toBeTruthy();
    expect(screen.getByLabelText("999 次")).toBeTruthy();
    expect(screen.getByTestId("dashboard-edgeone-package-traffic").textContent).toContain("500.00 MB / 10.00 GB");
    expect(screen.getByTestId("dashboard-edgeone-package-requests").textContent).toContain("500 次 / 20.00 M");
  });

  it("uses one aggregate request to refresh all seven cards and suppresses overlapping clicks", async () => {
    const pendingRefresh = deferred<DashboardOverviewResponse>();
    apiMocks.request
      .mockResolvedValueOnce(readyOverview(1))
      .mockReturnValueOnce(pendingRefresh.promise);

    renderPage();
    await screen.findByLabelText("1.00 GB");

    const refresh = screen.getByTestId("dashboard-refresh-all") as HTMLButtonElement;
    await waitFor(() => expect(refresh.disabled).toBe(false));
    fireEvent.click(refresh);
    fireEvent.click(refresh);

    expect(apiMocks.request).toHaveBeenCalledTimes(2);
    expect(refresh.disabled).toBe(true);
    expect(apiMocks.request).toHaveBeenLastCalledWith("/api/admin/dashboard/overview");

    pendingRefresh.resolve(readyOverview(5));

    await waitFor(() => expect(screen.getByTestId("dashboard-pv-today").textContent).toContain("5"));
    expect(screen.getByTestId("dashboard-pv-week").textContent).toContain("6");
    expect(screen.getByTestId("dashboard-pv-month").textContent).toContain("7");
    expect(screen.getByTestId("dashboard-edgeone-last24-traffic").textContent).toContain("5.00 GB");
    expect(screen.getByTestId("dashboard-edgeone-last24-requests").textContent).toContain("5.00 M");
    expect(screen.getByTestId("dashboard-edgeone-package-traffic").textContent).toContain("10.00 GB / 50.00 GB");
    expect(screen.getByTestId("dashboard-edgeone-package-requests").textContent).toContain("15.00 M / 100.00 M");
  });

  it("keeps the last successful EdgeOne values when only EdgeOne refresh fails", async () => {
    apiMocks.request.mockResolvedValueOnce(readyOverview(2));

    renderPage();
    await screen.findByLabelText("2.00 GB");

    apiMocks.request.mockResolvedValueOnce({
        todayUniqueUsers: 9,
        weekDailyUniqueUsers: 10,
        monthDailyUniqueUsers: 11,
        edgeOne: { status: "error", code: "EDGEONE_UPSTREAM_ERROR", message: "腾讯云暂时不可用" }
      } satisfies DashboardOverviewResponse);

    const refresh = screen.getByTestId("dashboard-refresh-all") as HTMLButtonElement;
    await waitFor(() => expect(refresh.disabled).toBe(false));
    fireEvent.click(refresh);

    await waitFor(() => expect(screen.getByTestId("dashboard-pv-today").textContent).toContain("9"));
    expect(screen.getByTestId("dashboard-edgeone-last24-traffic").textContent).toContain("2.00 GB");
    expect(screen.getByTestId("dashboard-edgeone-stale-warning").textContent).toContain("腾讯云暂时不可用");
  });

  it("offers a retry for initial failures and a configuration link when not configured", async () => {
    apiMocks.request
      .mockRejectedValueOnce(new Error("服务不可用"))
      .mockResolvedValueOnce({
        todayUniqueUsers: 1,
        weekDailyUniqueUsers: 2,
        monthDailyUniqueUsers: 3,
        edgeOne: { status: "not_configured" }
      } satisfies DashboardOverviewResponse);

    renderPage();
    const error = await screen.findByTestId("dashboard-load-error");
    expect(error.textContent).toContain("服务不可用");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    const configure = await screen.findByRole("button", { name: /前往系统配置/ });
    fireEvent.click(configure);
    await screen.findByText("系统配置目标页");
  });

  it("shows an EdgeOne-only initial error inside the EdgeOne panel", async () => {
    apiMocks.request.mockResolvedValueOnce({
      todayUniqueUsers: 1,
      weekDailyUniqueUsers: 2,
      monthDailyUniqueUsers: 3,
      edgeOne: {
        status: "error",
        code: "EDGEONE_UPSTREAM_ERROR",
        message: "腾讯云暂时不可用"
      }
    } satisfies DashboardOverviewResponse);

    renderPage();

    const error = await screen.findByTestId("dashboard-edgeone-error");
    expect(error.textContent).toContain("腾讯云暂时不可用");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
    expect(screen.getByText("官方计费数据可能延迟约 3 小时")).toBeTruthy();
  });
});
