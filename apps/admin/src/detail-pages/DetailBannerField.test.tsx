// @vitest-environment jsdom

import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetDto } from "@event-arts/shared";
import { request } from "../api";
import { DetailBannerField, validateDetailBannerIds } from "./DetailBannerField";

const unavailableIds = new Set<number>();

const assets = new Map<number, MediaAssetDto>([
  [
    1,
    {
      id: 1,
      resourceName: "舞台全景",
      originalName: "stage.webp",
      md5: "one",
      mimeType: "image/webp",
      mediaType: "image",
      url: "/uploads/stage.webp",
      width: 1500,
      height: 760,
      size: 100,
      storageType: "local",
      tags: [],
      referenceCount: 0,
      inUse: false,
      createdBy: 1,
      createdByName: "admin",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    }
  ],
  [
    2,
    {
      id: 2,
      resourceName: "主持特写",
      originalName: "host.webp",
      md5: "two",
      mimeType: "image/webp",
      mediaType: "image",
      url: "/uploads/host.webp",
      width: 1200,
      height: 800,
      size: 120,
      storageType: "local",
      tags: [],
      referenceCount: 0,
      inUse: false,
      createdBy: 1,
      createdByName: "admin",
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z"
    }
  ]
]);

vi.mock("../api", () => ({
  request: vi.fn(async (path: string) => {
    const id = Number(path.split("/").at(-1));
    if (unavailableIds.has(id)) throw new Error(`资源 #${id} 加载失败`);
    const asset = assets.get(id);
    if (!asset) throw new Error("missing fixture");
    return asset;
  })
}));

vi.mock("./MediaPickerModal", () => ({
  MediaPickerModal: ({ open, onCancel }: { open: boolean; onCancel: () => void }) =>
    open ? <div data-testid="detail-banner-picker">picker<button onClick={onCancel}>关闭资源选择器</button></div> : null
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
});

afterEach(cleanup);

beforeEach(() => {
  unavailableIds.clear();
  vi.mocked(request).mockClear();
});

describe("DetailBannerField", () => {
  it("validates that the form value contains 1–6 unique integer image ids", () => {
    expect(validateDetailBannerIds([])).toBe("请至少选择 1 张详情页 BANNER");
    expect(validateDetailBannerIds([1, 2, 3, 4, 5, 6, 7])).toBe("详情页 BANNER 最多选择 6 张");
    expect(validateDetailBannerIds([1, 1])).toBe("详情页 BANNER 不能选择重复资源");
    expect(validateDetailBannerIds([1, "2"])).toBe("详情页 BANNER 资源 ID 格式不正确");
    expect(validateDetailBannerIds([2, 1])).toBeNull();
  });

  it("renders ordered metadata and supports accessible move and remove actions", async () => {
    const onChange = vi.fn();
    await act(async () => {
      render(<DetailBannerField value={[2, 1]} onChange={onChange} />);
    });

    await waitFor(() => expect(screen.getByText("主持特写")).toBeTruthy());
    expect(screen.getByTestId("detail-banner-field")).toBeTruthy();
    expect(screen.getByTestId("detail-banner-item-2").textContent).toContain("第 1 张");
    expect(screen.getByTestId("detail-banner-item-2").textContent).toContain("1200 × 800");
    expect(screen.getByTestId("detail-banner-item-1").textContent).toContain("第 2 张");

    fireEvent.click(screen.getByRole("button", { name: "将 舞台全景 上移" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2]);

    fireEvent.click(screen.getByRole("button", { name: "删除 主持特写" }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });

  it("keeps a failed id visible in order and lets the user remove it", async () => {
    unavailableIds.add(2);
    const onChange = vi.fn();
    render(<DetailBannerField value={[1, 2]} onChange={onChange} />);

    const failedTile = await screen.findByTestId("detail-banner-error-2");
    expect(failedTile.textContent).toContain("资源 ID #2");
    expect(failedTile.textContent).toContain("第 2 张");
    expect(failedTile.textContent).toContain("加载失败");
    expect(screen.getByTestId("detail-banner-item-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "删除资源 #2" }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });

  it("retries failed metadata and restores the banner tile", async () => {
    unavailableIds.add(2);
    render(<DetailBannerField value={[2]} onChange={vi.fn()} />);

    await screen.findByTestId("detail-banner-error-2");
    expect(vi.mocked(request)).toHaveBeenCalledWith("/api/admin/media-assets/2");

    unavailableIds.delete(2);
    fireEvent.click(screen.getByRole("button", { name: "重试资源 #2" }));

    await waitFor(() => expect(screen.getByTestId("detail-banner-item-2")).toBeTruthy());
    expect(screen.queryByTestId("detail-banner-error-2")).toBeNull();
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
  });

  it("disables adding at six banners and exposes a stable picker test id only while open", () => {
    const { rerender } = render(<DetailBannerField value={[1]} onChange={vi.fn()} />);
    expect(screen.getByTestId("detail-banner-add")).not.toHaveProperty("disabled", true);
    fireEvent.click(screen.getByTestId("detail-banner-add"));
    expect(screen.getByTestId("detail-banner-picker")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭资源选择器" }));
    expect(screen.queryByTestId("detail-banner-picker")).toBeNull();

    rerender(<DetailBannerField value={[1, 2, 3, 4, 5, 6]} onChange={vi.fn()} />);
    expect(screen.getByTestId("detail-banner-add")).toHaveProperty("disabled", true);
  });
});
