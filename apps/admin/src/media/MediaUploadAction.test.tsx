// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetDto } from "@event-arts/shared";
import { MediaUploadAction } from "./MediaUploadAction";

const { notifyMock, prepareMediaFileMock, requestMock } = vi.hoisted(() => ({
  notifyMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  prepareMediaFileMock: vi.fn(),
  requestMock: vi.fn()
}));

vi.mock("../api", () => ({ request: requestMock }));
vi.mock("../notifications/notification", () => ({ notify: notifyMock }));
vi.mock("../utils/repeat-click-guard", () => ({ useRepeatClickGuard: () => (_key: string, action: () => unknown) => action() }));
vi.mock("./media-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media-file")>();
  return { ...actual, prepareMediaFile: prepareMediaFileMock };
});

vi.mock("antd", () => {
  const Form = ({ children }: { children?: ReactNode }) => <form>{children}</form>;
  Form.Item = ({ children, label }: { children?: ReactNode; label?: ReactNode }) => <label>{label}{children}</label>;
  return {
    Button: ({ children, disabled, loading, onClick, "data-testid": testid }: {
      children?: ReactNode;
      disabled?: boolean;
      loading?: boolean;
      onClick?: () => void;
      "data-testid"?: string;
    }) => <button data-testid={testid} disabled={disabled || loading} onClick={onClick}>{children}</button>,
    Form,
    Input: ({ value, onChange, "data-testid": testid }: {
      value?: string;
      onChange?: (event: { target: { value: string } }) => void;
      "data-testid"?: string;
    }) => <input data-testid={testid} value={value} onChange={onChange} />,
    Modal: ({ children, open, onCancel, onOk }: {
      children?: ReactNode;
      open?: boolean;
      onCancel?: () => void;
      onOk?: () => void;
    }) => open ? <section><button onClick={onCancel}>取消</button>{children}<button onClick={onOk}>上传</button></section> : null,
    Progress: () => null,
    Select: ({ value = [], options = [], filterOption, onChange, placeholder, "data-testid": testid }: {
      value?: string[];
      options?: Array<{ value: string; label: ReactNode }>;
      filterOption?: (input: string, option: { value: string; label: ReactNode }) => boolean;
      onChange?: (value: string[]) => void;
      placeholder?: string;
      "data-testid"?: string;
    }) => {
      const [input, setInput] = useState("");
      const visible = options.filter((option) => filterOption?.(input, option) ?? true);
      const create = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter" || !input.trim()) return;
        event.preventDefault();
        onChange?.([...value, input.trim()]);
        setInput("");
      };
      return <div data-testid={testid}>
        {value.map((item) => <span key={item}>{item}</span>)}
        <input aria-label="标签输入" placeholder={placeholder} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={create} />
        {visible.map((option) => <button key={option.value} type="button" role="option" onClick={() => onChange?.([...value, option.value])}>{option.label}</button>)}
      </div>;
    }
  };
});

const file = new File(["image"], "现场照片.png", { type: "image/png" });
const prepared = { file, md5: "abc", mimeType: "image/png", mediaType: "image", size: file.size, width: 1200, height: 800 };
const asset = {
  id: 1,
  resourceName: "现场照片.png",
  originalName: "现场照片.png",
  md5: "abc",
  mimeType: "image/png",
  mediaType: "image",
  url: "/uploads/1.png",
  width: 1200,
  height: 800,
  size: file.size,
  storageType: "local",
  tags: ["婚礼", "新标签"],
  referenceCount: 0,
  inUse: false,
  createdBy: 1,
  createdByName: "admin",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z"
} as MediaAssetDto;

beforeEach(() => {
  requestMock.mockReset();
  prepareMediaFileMock.mockReset().mockResolvedValue(prepared);
  Object.values(notifyMock).forEach((mock) => mock.mockReset());
});
afterEach(cleanup);

async function openUpload() {
  fireEvent.change(screen.getByTestId("media-action-upload-input"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText("实际尺寸：1200×800，MD5：abc")).toBeTruthy());
}

describe("MediaUploadAction", () => {
  it("filters historical labels, autocompletes a selection, keeps free input, and submits plain tag values", async () => {
    let uploadedForm: FormData | undefined;
    requestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/api/admin/media-assets/upload-config") return Promise.resolve({ image: { mimeTypes: ["image/png"], maxBytes: 1000 }, video: { mimeTypes: ["video/mp4"], maxBytes: 1000 } });
      if (path === "/api/admin/media-assets/lookup") return Promise.resolve({ asset: null });
      if (path === "/api/admin/media-assets/tags") return Promise.resolve({ items: [{ label: "婚礼", count: 3 }, { label: "舞台", count: 2 }] });
      if (path === "/api/admin/media-assets/check-name") return Promise.resolve({ available: true });
      if (path === "/api/admin/media-assets/upload") {
        uploadedForm = init?.body as FormData;
        return Promise.resolve({ asset, reused: false });
      }
      throw new Error(`unexpected request: ${path}`);
    });

    render(<MediaUploadAction onAsset={vi.fn()} />);
    await openUpload();
    await waitFor(() => expect(screen.getByRole("option", { name: "婚礼 (3)" })).toBeTruthy());

    const input = screen.getByLabelText("标签输入");
    fireEvent.change(input, { target: { value: "婚" } });
    expect(screen.getByRole("option", { name: "婚礼 (3)" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "舞台 (2)" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "婚礼 (3)" }));

    fireEvent.change(input, { target: { value: "新标签" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("婚礼")).toBeTruthy();
    expect(screen.getByText("新标签")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    await waitFor(() => expect(uploadedForm).toBeTruthy());
    expect(uploadedForm?.get("tags")).toBe(JSON.stringify(["婚礼", "新标签"]));
  });

  it("keeps manual tag entry available when historical labels fail to load", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/admin/media-assets/upload-config") return Promise.resolve({ image: { mimeTypes: ["image/png"], maxBytes: 1000 }, video: { mimeTypes: ["video/mp4"], maxBytes: 1000 } });
      if (path === "/api/admin/media-assets/lookup") return Promise.resolve({ asset: null });
      if (path === "/api/admin/media-assets/tags") return Promise.reject(new Error("offline"));
      throw new Error(`unexpected request: ${path}`);
    });

    render(<MediaUploadAction onAsset={vi.fn()} />);
    await openUpload();
    await waitFor(() => expect(notifyMock.warning).toHaveBeenCalledWith("历史标签加载失败，仍可手动输入标签"));
    const input = screen.getByLabelText("标签输入");
    fireEvent.change(input, { target: { value: "临时标签" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("临时标签")).toBeTruthy();
  });
});
