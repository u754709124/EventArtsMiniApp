// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../api";
import { DetailPageReferenceField } from "./DetailPageReferenceField";

vi.mock("../api", () => ({ request: vi.fn() }));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => ({
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
  vi.mocked(request).mockReset();
  vi.mocked(request).mockResolvedValue({ items: [] });
  vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DetailPageReferenceField", () => {
  it("filters option requests by detail type and reloads when the type changes", async () => {
    const { rerender } = render(<DetailPageReferenceField detailPageType="banner_rich_text" />);

    await waitFor(() => expect(vi.mocked(request).mock.calls.some(([path]) =>
      new URL(String(path), "http://localhost").searchParams.get("type") === "banner_rich_text"
    )).toBe(true));

    rerender(<DetailPageReferenceField detailPageType="rich_text" />);
    await waitFor(() => expect(vi.mocked(request).mock.calls.some(([path]) =>
      new URL(String(path), "http://localhost").searchParams.get("type") === "rich_text"
    )).toBe(true));
  });

  it("keeps existing unfiltered callers compatible and honors disabled state", async () => {
    const { rerender } = render(<DetailPageReferenceField />);
    await waitFor(() => expect(vi.mocked(request)).toHaveBeenCalled());
    const firstPath = String(vi.mocked(request).mock.calls[0][0]);
    expect(new URL(firstPath, "http://localhost").searchParams.has("type")).toBe(false);

    const requestCount = vi.mocked(request).mock.calls.length;
    rerender(<DetailPageReferenceField disabled />);
    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("detail-page-reference-create")).toHaveProperty("disabled", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(request)).toHaveBeenCalledTimes(requestCount);
  });

  it("passes the selected type to the new-detail-page flow", async () => {
    render(<DetailPageReferenceField detailPageType="rich_text" />);
    fireEvent.click(screen.getByTestId("detail-page-reference-create"));

    expect(window.open).toHaveBeenCalledTimes(1);
    const target = String(vi.mocked(window.open).mock.calls[0][0]);
    const url = new URL(target, "http://localhost");
    expect(url.pathname).toBe("/admin/detail-pages/new");
    expect(url.searchParams.get("type")).toBe("rich_text");
    expect(url.searchParams.get("returnToken")).toBeTruthy();
  });

  it("clears a filled value when its real detail type does not match", async () => {
    const onChange = vi.fn();
    vi.mocked(request).mockImplementation(async (path) => {
      if (String(path) === "/api/admin/detail-pages/7") {
        return { id: 7, name: "视觉详情", type: "banner_rich_text", typeLabel: "BANNER + 富文本" };
      }
      return { items: [] };
    });

    function Harness() {
      const [value, setValue] = useState<number | null>(7);
      return (
        <DetailPageReferenceField
          value={value}
          detailPageType="rich_text"
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });
});
