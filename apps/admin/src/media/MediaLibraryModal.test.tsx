// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetDto } from "@event-arts/shared";
import { MediaLibraryModal } from "./MediaLibraryModal";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock("../api", () => ({ request: requestMock }));

vi.mock("antd", () => ({
  Button: ({ children, className, disabled, onClick, "aria-label": ariaLabel }: {
    children?: ReactNode;
    className?: string;
    disabled?: boolean;
    onClick?: () => void;
    "aria-label"?: string;
  }) => <button className={className} disabled={disabled} aria-label={ariaLabel} onClick={onClick}>{children}</button>,
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Input: {
    Search: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => <input aria-label={ariaLabel} />
  },
  Modal: ({ open, title, children }: { open: boolean; title?: ReactNode; children?: ReactNode }) =>
    open ? <section>{title}{children}</section> : null,
  Pagination: () => null,
  Select: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => <select aria-label={ariaLabel} />,
  Space: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Spin: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Tabs: ({ activeKey, items, onChange }: {
    activeKey: string;
    items: Array<{ key: string; label: ReactNode }>;
    onChange: (key: string) => void;
  }) => <div>{items.map((item) => (
    <button
      key={item.key}
      role="tab"
      aria-selected={activeKey === item.key}
      onClick={() => onChange(item.key)}
    >
      {item.label}
    </button>
  ))}</div>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  message: { error: vi.fn() }
}));

type MediaListResponse = { items: MediaAssetDto[]; total: number; page: number; pageSize: number };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function asset(id: number, resourceName: string, mediaType: "image" | "video") {
  return {
    id,
    resourceName,
    originalName: `${resourceName}.${mediaType === "image" ? "webp" : "mp4"}`,
    md5: String(id),
    mimeType: mediaType === "image" ? "image/webp" : "video/mp4",
    mediaType,
    url: `/uploads/${id}`,
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
  } as MediaAssetDto;
}

function response(item: MediaAssetDto): MediaListResponse {
  return { items: [item], total: 1, page: 1, pageSize: 20 };
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
  requestMock.mockReset();
});
afterEach(cleanup);

describe("MediaLibraryModal", () => {
  it("normalizes a changed field type synchronously and ignores an older response", async () => {
    const listRequests: Array<{ path: string; pending: ReturnType<typeof deferred<MediaListResponse>> }> = [];
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/admin/media-assets/tags") return Promise.resolve({ items: [] });
      const pending = deferred<MediaListResponse>();
      listRequests.push({ path, pending });
      return pending.promise;
    });

    const { rerender } = render(
      <MediaLibraryModal
        open
        fieldKey="case.detail"
        allowedTypes={["video"]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    await waitFor(() => expect(listRequests).toHaveLength(1));
    expect(listRequests[0].path).toContain("mediaType=video");

    rerender(
      <MediaLibraryModal
        open
        fieldKey="banner.image"
        allowedTypes={["image"]}
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    await waitFor(() => expect(listRequests.some(({ path }) => path.includes("mediaType=image"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listRequests).toHaveLength(2);
    expect(listRequests[1].path).toContain("mediaType=image");

    const current = listRequests[1];
    current.pending.resolve(response(asset(2, "当前图片", "image")));
    await waitFor(() => expect(screen.getByText("当前图片")).toBeTruthy());

    listRequests[0].pending.resolve(response(asset(1, "过期视频", "video")));
    await waitFor(() => expect(screen.getByText("当前图片")).toBeTruthy());
    expect(screen.queryByText("过期视频")).toBeNull();
  });

  it("keeps tab switching compatible when both media types are allowed", async () => {
    const paths: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/admin/media-assets/tags") return Promise.resolve({ items: [] });
      paths.push(path);
      const type = new URL(path, "http://localhost").searchParams.get("mediaType");
      return Promise.resolve(response(asset(type === "video" ? 4 : 3, type === "video" ? "视频资源" : "图片资源", type as "image" | "video")));
    });

    render(
      <MediaLibraryModal
        open
        fieldKey="case.detail"
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText("图片资源")).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "视频" }));
    await waitFor(() => expect(screen.getByText("视频资源")).toBeTruthy());
    expect(paths.at(-1)).toContain("mediaType=video");
  });
});
