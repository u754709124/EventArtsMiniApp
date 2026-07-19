// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeOneConfigResponse } from "@event-arts/shared";
import { ApiError } from "../api";
import { SystemConfigPage } from "./SystemConfigPage";

const apiMocks = vi.hoisted(() => ({ request: vi.fn() }));
const guardMocks = vi.hoisted(() => ({ useDirtyFormGuard: vi.fn() }));

vi.mock("../api", () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status: number
    ) {
      super(message);
    }
  }
  return { ApiError: MockApiError, request: apiMocks.request };
});

vi.mock("../forms/unsaved-changes", () => guardMocks);

const configured: EdgeOneConfigResponse = {
  zoneId: "zone-current",
  secretIdMasked: "AKID****7890",
  secretIdConfigured: true,
  secretKeyConfigured: true,
  updatedAt: "2026-07-16T08:00:00.000Z"
};

const notConfigured: EdgeOneConfigResponse = {
  zoneId: null,
  secretIdMasked: null,
  secretIdConfigured: false,
  secretKeyConfigured: false,
  updatedAt: null
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SystemConfigPage />
    </MemoryRouter>
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  apiMocks.request.mockReset();
  guardMocks.useDirtyFormGuard.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SystemConfigPage", () => {
  it("keeps configured secrets blank, submits only ZoneId when unchanged, and clears secrets after success", async () => {
    apiMocks.request
      .mockResolvedValueOnce(configured)
      .mockResolvedValueOnce({ ...configured, updatedAt: "2026-07-16T09:00:00.000Z" });

    renderPage();

    const zoneId = await screen.findByTestId("edgeone-zone-id") as HTMLInputElement;
    const secretId = screen.getByTestId("edgeone-secret-id") as HTMLInputElement;
    const secretKey = screen.getByTestId("edgeone-secret-key") as HTMLInputElement;
    expect(zoneId.value).toBe("zone-current");
    expect(secretId.value).toBe("");
    expect(secretKey.value).toBe("");
    expect(screen.getByText(/AKID\*\*\*\*7890/)).toBeTruthy();
    expect(screen.getAllByText(/留空保持不变/)).toHaveLength(2);

    fireEvent.change(secretId, { target: { value: "AKIDROTATED" } });
    fireEvent.change(secretKey, { target: { value: "rotated-secret-key" } });
    await waitFor(() => {
      expect(guardMocks.useDirtyFormGuard).toHaveBeenCalledWith("edgeone-system-config", true);
    });
    fireEvent.click(screen.getByTestId("edgeone-config-save"));

    await waitFor(() => expect(apiMocks.request).toHaveBeenCalledTimes(2));
    expect(apiMocks.request).toHaveBeenLastCalledWith("/api/admin/system-config/edgeone", {
      method: "PUT",
      body: JSON.stringify({
        zoneId: "zone-current",
        secretId: "AKIDROTATED",
        secretKey: "rotated-secret-key"
      })
    });
    await waitFor(() => {
      expect(secretId.value).toBe("");
      expect(secretKey.value).toBe("");
    });
    expect(guardMocks.useDirtyFormGuard).toHaveBeenCalledWith("edgeone-system-config", false);
  });

  it("requires both CAM credentials for the first configuration", async () => {
    apiMocks.request.mockResolvedValueOnce(notConfigured);

    renderPage();
    await screen.findByTestId("edgeone-zone-id");
    fireEvent.change(screen.getByTestId("edgeone-zone-id"), { target: { value: "zone-first" } });
    fireEvent.click(screen.getByTestId("edgeone-config-save"));

    expect(await screen.findByText("首次配置请输入 SecretId")).toBeTruthy();
    expect(await screen.findByText("首次配置请输入 SecretKey")).toBeTruthy();
    expect(apiMocks.request).toHaveBeenCalledTimes(1);
  });

  it("maps a Zone validation failure to the field and preserves credential input", async () => {
    apiMocks.request
      .mockResolvedValueOnce(configured)
      .mockRejectedValueOnce(new ApiError("Zone 不属于当前账号套餐", "EDGEONE_ZONE_NOT_FOUND", 422));

    renderPage();
    const zoneId = await screen.findByTestId("edgeone-zone-id") as HTMLInputElement;
    const secretId = screen.getByTestId("edgeone-secret-id") as HTMLInputElement;
    const secretKey = screen.getByTestId("edgeone-secret-key") as HTMLInputElement;
    fireEvent.change(zoneId, { target: { value: "zone-missing" } });
    fireEvent.change(secretId, { target: { value: "AKIDTRYAGAIN" } });
    fireEvent.change(secretKey, { target: { value: "keep-this-secret" } });
    fireEvent.click(screen.getByTestId("edgeone-config-save"));

    expect(await screen.findByText("Zone 不属于当前账号套餐")).toBeTruthy();
    expect(zoneId.value).toBe("zone-missing");
    expect(secretId.value).toBe("AKIDTRYAGAIN");
    expect(secretKey.value).toBe("keep-this-secret");
    expect(guardMocks.useDirtyFormGuard).toHaveBeenCalledWith("edgeone-system-config", true);
  });

  it("shows credential and permission failures inline without clearing the input", async () => {
    apiMocks.request
      .mockResolvedValueOnce(configured)
      .mockRejectedValueOnce(new ApiError("CAM 子账号缺少 DescribeBillingData 权限", "EDGEONE_VALIDATION_FAILED", 422));

    renderPage();
    const secretKey = await screen.findByTestId("edgeone-secret-key") as HTMLInputElement;
    fireEvent.change(secretKey, { target: { value: "correct-me" } });
    fireEvent.click(screen.getByTestId("edgeone-config-save"));

    const alert = await screen.findByTestId("edgeone-config-submit-error");
    expect(alert.textContent).toContain("CAM 子账号缺少 DescribeBillingData 权限");
    expect(secretKey.value).toBe("correct-me");
  });
});
