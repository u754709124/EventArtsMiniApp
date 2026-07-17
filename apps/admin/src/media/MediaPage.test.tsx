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
    const confirm = await screen.findByRole("button", { name: "开始预热" });
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
});
