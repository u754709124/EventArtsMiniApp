// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPage } from "./MediaPage";

const apiMocks = vi.hoisted(() => ({ request: vi.fn() }));
const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn()
}));

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number
    ) {
      super(message);
    }
  },
  request: apiMocks.request
}));

vi.mock("../notifications/notification", () => ({
  notify: notificationMocks
}));

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
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  apiMocks.request.mockReset();
  Object.values(notificationMocks).forEach((mock) => mock.mockReset());
});

afterEach(cleanup);

describe("MediaPage EdgeOne prefetch", () => {
  it("guards the confirmation action so a pending prefetch is posted only once", async () => {
    let resolvePrefetch!: (value: unknown) => void;
    const pendingPrefetch = new Promise((resolve) => {
      resolvePrefetch = resolve;
    });
    apiMocks.request.mockImplementation((url: string, options?: { method?: string }) => {
      if (url.startsWith("/api/admin/media-assets?")) {
        return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 });
      }
      if (url === "/api/admin/media-assets/tags") return Promise.resolve({ items: [] });
      if (url === "/api/admin/edgeone/prefetch" && options?.method === "POST") {
        return pendingPrefetch;
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<MediaPage />);
    const trigger = await screen.findByTestId("media-edgeone-prefetch");
    fireEvent.click(trigger);
    const confirm = await screen.findByRole(
      "button",
      { name: "开始预热" },
      { timeout: 3_000 }
    );
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(apiMocks.request.mock.calls.filter(
        ([url, options]) => url === "/api/admin/edgeone/prefetch" && options?.method === "POST"
      )).toHaveLength(1);
    });
    expect(trigger.getAttribute("disabled")).not.toBeNull();

    resolvePrefetch({ submitted: 1, skipped: 0, ineligible: 0, failed: 0, items: [] });
    await waitFor(() => expect(notificationMocks.success).toHaveBeenCalledOnce());
  });

  it.each([
    {
      status: "failed",
      safeErrorCode: "EDGEONE_PERMISSION_DENIED",
      safeErrorMessage: "CAM 子账号缺少预热查询权限",
      label: "预热失败",
      expected: "EDGEONE_PERMISSION_DENIED：CAM 子账号缺少预热查询权限"
    },
    {
      status: "failed",
      safeErrorCode: null,
      safeErrorMessage: null,
      label: "预热失败",
      expected: "预热失败，暂无可展示原因"
    },
    {
      status: "timeout",
      safeErrorCode: null,
      safeErrorMessage: null,
      label: "预热超时",
      expected: "预热超时，暂无可展示原因"
    },
    {
      status: "canceled",
      safeErrorCode: null,
      safeErrorMessage: null,
      label: "已取消",
      expected: "预热已取消，暂无可展示原因"
    },
    {
      status: "invalid",
      safeErrorCode: null,
      safeErrorMessage: null,
      label: "资源无效",
      expected: "资源无效，暂无可展示原因"
    }
  ])("shows the safe failure reason in the $status resource row", async (failure) => {
    const asset = {
      id: 901,
      resourceName: "prefetch.jpg",
      originalName: "prefetch.jpg",
      filename: "prefetch.jpg",
      md5: "0123456789abcdef0123456789abcdef",
      mimeType: "image/jpeg",
      mediaType: "image",
      url: "/uploads/prefetch.jpg",
      width: 710,
      height: 290,
      size: 1024,
      storageType: "local",
      createdBy: 1,
      createdByName: "admin",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      tags: [],
      inUse: false,
      referenceCount: 0
    };
    apiMocks.request.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/media-assets?")) {
        return Promise.resolve({ items: [asset], total: 1, page: 1, pageSize: 20 });
      }
      if (url === "/api/admin/media-assets/tags") return Promise.resolve({ items: [] });
      if (url.startsWith("/api/admin/edgeone/prefetch?")) {
        return Promise.resolve({
          items: [{
            id: 1,
            mediaAssetId: asset.id,
            mode: "default",
            status: failure.status,
            attemptCount: 1,
            nextRetryAt: null,
            lastSubmittedAt: "2026-07-17T00:00:00.000Z",
            completedAt: "2026-07-17T00:00:10.000Z",
            safeErrorCode: failure.safeErrorCode,
            safeErrorMessage: failure.safeErrorMessage,
            updatedAt: "2026-07-17T00:00:10.000Z"
          }],
          total: 1,
          page: 1,
          pageSize: 100
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<MediaPage />);
    expect(await screen.findByText(failure.expected)).toBeTruthy();
    expect(screen.getByLabelText(`${failure.label}：${failure.expected}`)).toBeTruthy();
  });

  it.each(["processing", "success"] as const)("does not show failure reasons for %s resource rows", async (status) => {
    const asset = {
      id: 902,
      resourceName: "prefetch-active.jpg",
      originalName: "prefetch-active.jpg",
      filename: "prefetch-active.jpg",
      md5: "1123456789abcdef0123456789abcdef",
      mimeType: "image/jpeg",
      mediaType: "image",
      url: "/uploads/prefetch-active.jpg",
      width: 710,
      height: 290,
      size: 1024,
      storageType: "local",
      createdBy: 1,
      createdByName: "admin",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
      tags: [],
      inUse: false,
      referenceCount: 0
    };
    apiMocks.request.mockImplementation((url: string) => {
      if (url.startsWith("/api/admin/media-assets?")) {
        return Promise.resolve({ items: [asset], total: 1, page: 1, pageSize: 20 });
      }
      if (url === "/api/admin/media-assets/tags") return Promise.resolve({ items: [] });
      if (url.startsWith("/api/admin/edgeone/prefetch?")) {
        return Promise.resolve({
          items: [{
            id: 1,
            mediaAssetId: asset.id,
            mode: "default",
            status,
            attemptCount: 1,
            nextRetryAt: null,
            lastSubmittedAt: "2026-07-17T00:00:00.000Z",
            completedAt: status === "success" ? "2026-07-17T00:00:10.000Z" : null,
            safeErrorCode: "SHOULD_NOT_RENDER",
            safeErrorMessage: "不应展示",
            updatedAt: "2026-07-17T00:00:10.000Z"
          }],
          total: 1,
          page: 1,
          pageSize: 100
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<MediaPage />);
    expect(await screen.findByText(status === "success" ? "预热成功" : "预热中")).toBeTruthy();
    expect(screen.queryByText(/SHOULD_NOT_RENDER|不应展示/)).toBeNull();
  });
});
