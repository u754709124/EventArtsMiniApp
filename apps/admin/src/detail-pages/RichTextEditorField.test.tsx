// @vitest-environment jsdom

import { StrictMode, act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAssetDto } from "@event-arts/shared";
import type { Editor } from "@tiptap/core";
import {
  RichTextEditorField,
  isSafeAssetMediaSource,
  normalizeMediaAssetId,
  type RichTextEditorLifecycleObserver
} from "./RichTextEditorField";

const imageAsset: MediaAssetDto = {
  id: 123,
  resourceName: "内容图片",
  originalName: "content.webp",
  md5: "image-md5",
  mimeType: "image/webp",
  mediaType: "image",
  url: "/uploads/content.webp",
  width: 1200,
  height: 800,
  size: 1024,
  storageType: "local",
  tags: [],
  referenceCount: 0,
  inUse: false,
  createdBy: 1,
  createdByName: "admin",
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z"
};

const videoAsset: MediaAssetDto = {
  ...imageAsset,
  id: 456,
  resourceName: "内容视频",
  originalName: "content.mp4",
  md5: "video-md5",
  mimeType: "video/mp4",
  mediaType: "video",
  url: "/uploads/content.mp4",
  width: 1920,
  height: 1080
};

let pickerProps: {
  open: boolean;
  fieldKey?: string;
  allowedTypes?: readonly string[];
  onCancel: () => void;
  onSelect: (asset: MediaAssetDto) => void;
} | null = null;

vi.mock("./MediaPickerModal", () => ({
  MediaPickerModal: (props: typeof pickerProps) => {
    pickerProps = props;
    if (!props?.open) return null;
    return (
      <div data-testid="rich-text-media-picker">
        <button onClick={() => props.onSelect(imageAsset)}>选择测试图片</button>
        <button onClick={() => props.onSelect(videoAsset)}>选择测试视频</button>
        <button onClick={props.onCancel}>关闭媒体选择器</button>
      </div>
    );
  }
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
  Element.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({})
  }));
});

beforeEach(() => {
  pickerProps = null;
  vi.restoreAllMocks();
});

afterEach(cleanup);

function editorObserver() {
  let editor: Editor | null = null;
  const observer: RichTextEditorLifecycleObserver = {
    onCreate(instance) {
      editor = instance;
    },
    onDestroy(instance) {
      if (editor === instance) editor = null;
    }
  };
  return {
    observer,
    get current() {
      return editor;
    }
  };
}

describe("RichTextEditorField", () => {
  it("renders the complete accessible toolbar and emits HTML from real Tiptap commands", async () => {
    const lifecycle = editorObserver();
    const onChange = vi.fn();
    render(
      <RichTextEditorField
        value="<p>主持人介绍</p>"
        onChange={onChange}
        lifecycleObserver={lifecycle.observer}
      />
    );

    await waitFor(() => expect(lifecycle.current).not.toBeNull());
    expect(screen.getByTestId("detail-rich-text-editor")).toBeTruthy();
    expect(screen.getByText("详情页富文本")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "段落与标题" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "字号" })).toBeTruthy();
    expect(screen.getByLabelText("文字颜色")).toBeTruthy();

    for (const name of [
      "粗体", "斜体", "下划线", "删除线", "左对齐", "居中", "右对齐",
      "有序列表", "无序列表", "引用", "分割线", "添加链接", "插入图片",
      "插入视频", "撤销", "重做", "清除格式"
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }

    act(() => {
      lifecycle.current?.commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "粗体" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("<p><strong>主持人介绍</strong></p>"));

    fireEvent.change(screen.getByRole("combobox", { name: "段落与标题" }), { target: { value: "h2" } });
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h2>"));

    fireEvent.change(screen.getByRole("combobox", { name: "字号" }), { target: { value: "24px" } });
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("font-size: 24px"));

    fireEvent.click(screen.getByRole("button", { name: "居中" }));
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("text-align: center"));
  });

  it("uses the shared type-filtered picker and serializes stable image and video attributes", async () => {
    const lifecycle = editorObserver();
    const onChange = vi.fn();
    render(<RichTextEditorField value="<p>前文</p>" onChange={onChange} lifecycleObserver={lifecycle.observer} />);
    await waitFor(() => expect(lifecycle.current).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "插入图片" }));
    expect(pickerProps?.fieldKey).toBe("detail.richText");
    expect(pickerProps?.allowedTypes).toEqual(["image"]);
    fireEvent.click(screen.getByRole("button", { name: "选择测试图片" }));
    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string;
      expect(html).toContain('src="/uploads/content.webp"');
      expect(html).toContain('data-media-asset-id="123"');
      expect(html).toContain('class="ea-media ea-image"');
      expect(html).toContain('alt="内容图片"');
    });

    let imagePosition = -1;
    lifecycle.current?.state.doc.descendants((node, position) => {
      if (node.type.name === "assetImage") imagePosition = position;
    });
    expect(imagePosition).toBeGreaterThanOrEqual(0);
    await act(async () => {
      lifecycle.current?.commands.setNodeSelection(imagePosition);
    });
    vi.spyOn(window, "prompt").mockReturnValueOnce("舞台内容图");
    fireEvent.click(screen.getByRole("button", { name: "编辑图片替代文本" }));
    fireEvent.click(screen.getByRole("button", { name: "右对齐" }));
    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string;
      expect(html).toContain('alt="舞台内容图"');
      expect(html).toContain('class="ea-media ea-image ea-align-right"');
    });

    fireEvent.click(screen.getByRole("button", { name: "插入视频" }));
    expect(pickerProps?.fieldKey).toBe("detail.richText");
    expect(pickerProps?.allowedTypes).toEqual(["video"]);
    fireEvent.click(screen.getByRole("button", { name: "选择测试视频" }));
    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string;
      expect(html).toContain('src="/uploads/content.mp4"');
      expect(html).toContain('data-media-asset-id="456"');
      expect(html).toContain('class="ea-media ea-video"');
      expect(html).toContain("controls");
      expect(html).toContain('preload="metadata"');
      expect(html).not.toMatch(/autoplay|loop|iframe/i);
    });
    expect(lifecycle.current?.getJSON().content?.some((node) => node.type === "assetVideo")).toBe(true);
  });

  it("rejects invalid ids and temporary or unregistered direct media sources", () => {
    expect(normalizeMediaAssetId(12)).toBe(12);
    expect(normalizeMediaAssetId("12")).toBe(12);
    expect(normalizeMediaAssetId(0)).toBeNull();
    expect(normalizeMediaAssetId("1.2")).toBeNull();
    expect(normalizeMediaAssetId("abc")).toBeNull();

    expect(isSafeAssetMediaSource("/uploads/registered.webp")).toBe(true);
    expect(isSafeAssetMediaSource("data:image/png;base64,abc")).toBe(false);
    expect(isSafeAssetMediaSource("blob:https://example.test/id")).toBe(false);
    expect(isSafeAssetMediaSource("file:///tmp/file.png")).toBe(false);
    expect(isSafeAssetMediaSource("wxfile://tmp/file.png")).toBe(false);
    expect(isSafeAssetMediaSource("/tmp/file.png")).toBe(false);
    expect(isSafeAssetMediaSource("https://unregistered.invalid/file.png")).toBe(false);
  });

  it("round-trips canonical remote media only when it carries a valid registered asset id", async () => {
    const lifecycle = editorObserver();
    const canonical =
      '<img src="https://assets.example.com/registered.webp" alt="对象存储图片" data-media-asset-id="808" class="ea-media ea-image">' +
      '<video src="https://assets.example.com/registered.mp4" data-media-asset-id="809" class="ea-media ea-video" controls preload="metadata"></video>';
    const { rerender } = render(
      <RichTextEditorField value={canonical} onChange={vi.fn()} lifecycleObserver={lifecycle.observer} />
    );

    await waitFor(() => {
      const html = lifecycle.current?.getHTML() ?? "";
      expect(html).toContain('src="https://assets.example.com/registered.webp"');
      expect(html).toContain('data-media-asset-id="808"');
      expect(html).toContain('src="https://assets.example.com/registered.mp4"');
      expect(html).toContain('data-media-asset-id="809"');
    });

    rerender(
      <RichTextEditorField
        value='<img src="https://unregistered.invalid/no-id.webp"><video src="https://unregistered.invalid/no-id.mp4"></video>'
        onChange={vi.fn()}
        lifecycleObserver={lifecycle.observer}
      />
    );
    await waitFor(() => {
      const html = lifecycle.current?.getHTML() ?? "";
      expect(html).not.toContain("unregistered.invalid");
      expect(html).not.toMatch(/<img|<video/);
    });
  });

  it("synchronizes edit refill, reset, clear and disabled state without emitting external updates", async () => {
    const lifecycle = editorObserver();
    const onChange = vi.fn();
    const { rerender } = render(
      <RichTextEditorField value="<p>初始内容</p>" onChange={onChange} lifecycleObserver={lifecycle.observer} />
    );
    await waitFor(() => expect(lifecycle.current?.getHTML()).toBe("<p>初始内容</p>"));

    rerender(<RichTextEditorField value="<h3>编辑回填</h3>" onChange={onChange} lifecycleObserver={lifecycle.observer} />);
    await waitFor(() => expect(lifecycle.current?.getHTML()).toBe("<h3>编辑回填</h3>"));
    expect(onChange).not.toHaveBeenCalled();

    rerender(<RichTextEditorField value="" onChange={onChange} lifecycleObserver={lifecycle.observer} />);
    await waitFor(() => expect(lifecycle.current?.getHTML()).toBe("<p></p>"));
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <RichTextEditorField
        value="<p>只读内容</p>"
        onChange={onChange}
        disabled
        lifecycleObserver={lifecycle.observer}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "详情页富文本内容" }).getAttribute("contenteditable")).toBe("false");
    });
    expect(screen.getByRole("button", { name: "粗体" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "插入图片" })).toHaveProperty("disabled", true);
  });

  it("never has more than one live editor in StrictMode and destroys it on unmount", async () => {
    const active = new Set<unknown>();
    let maximumActive = 0;
    const observer: RichTextEditorLifecycleObserver = {
      onCreate(editor) {
        active.add(editor);
        maximumActive = Math.max(maximumActive, active.size);
      },
      onDestroy(editor) {
        active.delete(editor);
      }
    };
    const { unmount } = render(
      <StrictMode>
        <RichTextEditorField value="<p>严格模式</p>" onChange={vi.fn()} lifecycleObserver={observer} />
      </StrictMode>
    );

    await waitFor(() => expect(active.size).toBe(1));
    expect(maximumActive).toBe(1);
    unmount();
    await waitFor(() => expect(active.size).toBe(0));
  });
});
