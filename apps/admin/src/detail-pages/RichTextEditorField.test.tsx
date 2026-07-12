// @vitest-environment jsdom

import { StrictMode, act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildArtistProfileTemplate, type MediaAssetDto } from "@event-arts/shared";
import type { Editor } from "@tiptap/core";
import {
  RichTextEditorField,
  isSafeAssetMediaSource,
  normalizeMediaAssetId,
  sanitizeRichTextClassName,
  sanitizeRichTextStyle,
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

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

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
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
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

afterAll(() => {
  if (previousActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
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

function canonicalArtistTemplate() {
  return buildArtistProfileTemplate([801, 802])
    .replace(
      /<img data-media-asset-id="(\d+)"/g,
      '<img src="https://assets.example.com/$1.webp" data-media-asset-id="$1"'
    )
    .replace(
      "林然，资深",
      '<span class="ea-intro unknown-inline" style="font-size:18px;color:#663300;background-image:url(javascript:bad)">林然</span>，资深'
    );
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
    expect(screen.getByRole("textbox", { name: "详情页富文本内容" }).getAttribute("aria-multiline")).toBe("true");
    expect(screen.getByRole("combobox", { name: "段落与标题" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "字号" })).toBeTruthy();
    expect(screen.getByLabelText("文字颜色")).toBeTruthy();

    for (const name of [
      "粗体", "斜体", "下划线", "删除线", "添加链接", "插入图片",
      "插入视频", "撤销", "重做", "清除格式", "左对齐", "居中",
      "右对齐", "有序列表", "无序列表", "引用", "分割线"
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }

    act(() => {
      lifecycle.current?.commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "粗体" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("<p><strong>主持人介绍</strong></p>"));

    fireEvent.change(screen.getByRole("combobox", { name: "段落与标题" }), { target: { value: "h1" } });
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("<h1>"));

    fireEvent.change(screen.getByRole("combobox", { name: "字号" }), { target: { value: "24px" } });
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0]).toContain("font-size: 24px"));

    expect([...screen.getByRole("combobox", { name: "段落与标题" }).querySelectorAll("option")].map((option) => option.value)).toEqual(["p", "h1"]);
  }, 15000);

  it("keeps whitespace-aware content parsing and floats the toolbar inside the editor frame", async () => {
    const lifecycle = editorObserver();
    render(
      <RichTextEditorField
        value={"<p>第一  第二</p><p><br></p><p>第三\n\n第四</p>"}
        onChange={vi.fn()}
        lifecycleObserver={lifecycle.observer}
      />
    );

    await waitFor(() => expect(lifecycle.current).not.toBeNull());
    expect(lifecycle.current?.options.parseOptions).toMatchObject({ preserveWhitespace: "full" });
    expect(lifecycle.current?.getHTML()).toContain("第一  第二");
    expect(lifecycle.current?.getHTML()).toContain("第三\n\n第四");

    const frame = screen.getByTestId("detail-rich-text-frame");
    expect(frame.contains(screen.getByTestId("detail-rich-text-toolbar"))).toBe(true);
    expect(frame.contains(screen.getByRole("textbox", { name: "详情页富文本内容" }))).toBe(true);
  });

  it("preserves the new H1 template order while stripping legacy classes after editing", async () => {
    const lifecycle = editorObserver();
    const onChange = vi.fn();
    render(
      <RichTextEditorField
        value={canonicalArtistTemplate()}
        onChange={onChange}
        lifecycleObserver={lifecycle.observer}
      />
    );
    await waitFor(() => expect(lifecycle.current).not.toBeNull());

    let firstParagraphPosition = -1;
    lifecycle.current?.state.doc.descendants((node, position) => {
      if (firstParagraphPosition < 0 && node.type.name === "paragraph") firstParagraphPosition = position;
    });
    expect(firstParagraphPosition).toBeGreaterThanOrEqual(0);
    await act(async () => {
      lifecycle.current?.commands.setTextSelection(firstParagraphPosition + 1);
      lifecycle.current?.commands.insertContent("已编辑：");
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = lifecycle.current?.getHTML() ?? "";
    const template = document.createElement("template");
    template.innerHTML = html;
    const headings = [...template.content.querySelectorAll("h1")];
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "个人简介",
      "服务优势",
      "代表案例",
      "服务流程",
      "客户评价",
      "档期提醒"
    ]);
    expect(template.content.querySelectorAll("section,div,ul,ol,li,blockquote,hr,h2,h3,h4")).toHaveLength(0);
    expect(template.content.querySelectorAll("img[data-media-asset-id]")).toHaveLength(7);
    expect(template.content.querySelector("p")?.textContent?.startsWith("已编辑：")).toBe(true);
    expect(template.content.querySelector("span")?.textContent).toBe("已编辑：林然");

    const intro = template.content.querySelector("span") as HTMLElement;
    expect(intro.className).toBe("");
    expect(intro.getAttribute("style")).toContain("font-size: 18px");
    expect(intro.getAttribute("style")).not.toContain("background-image");
    expect(html).not.toContain("unknown-inline");
    expect(html).not.toContain("javascript:");
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
    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string;
      expect(html).toContain('alt="舞台内容图"');
    });

    fireEvent.click(screen.getByRole("button", { name: "插入视频" }));
    expect(pickerProps?.fieldKey).toBe("detail.richText");
    expect(pickerProps?.allowedTypes).toEqual(["video"]);
    fireEvent.click(screen.getByRole("button", { name: "选择测试视频" }));
    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string;
      expect(html).toContain('src="/uploads/content.webp"');
      expect(html).toContain('data-media-asset-id="123"');
      expect(html).toContain('src="/uploads/content.mp4"');
      expect(html).toContain('data-media-asset-id="456"');
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
    expect(isSafeAssetMediaSource("/\\evil.invalid/video.mp4")).toBe(false);
    expect(isSafeAssetMediaSource("/%5cevil.invalid/video.mp4")).toBe(false);
    expect(isSafeAssetMediaSource("/%5C%5Cevil.invalid/video.mp4")).toBe(false);
    expect(isSafeAssetMediaSource("https://unregistered.invalid/file.png")).toBe(false);

    expect(sanitizeRichTextClassName("unknown fixed")).toBeNull();
    expect(sanitizeRichTextStyle("color:#663300;padding:16px;position:fixed;background-image:url(x)")).toBe(
      "color: #663300; padding: 16px"
    );
  });

  it("rejects disguised remote local paths before parse or render while retaining normal uploads", async () => {
    const lifecycle = editorObserver();
    const disguised =
      '<video src="/\\evil.invalid/video.mp4" data-media-asset-id="910"></video>' +
      '<img src="/%5cevil.invalid/image.webp" data-media-asset-id="911">' +
      '<img src="/uploads/normal.webp" data-media-asset-id="912" alt="正常图片">';
    render(<RichTextEditorField value={disguised} onChange={vi.fn()} lifecycleObserver={lifecycle.observer} />);

    await waitFor(() => expect(lifecycle.current).not.toBeNull());
    await waitFor(() => {
      const html = lifecycle.current?.getHTML() ?? "";
      expect(html).not.toContain("evil.invalid");
      expect(html).not.toContain("video.mp4");
      expect(html).toContain('src="/uploads/normal.webp"');
      expect(html).toContain('data-media-asset-id="912"');
    });
    expect(screen.getByRole("textbox", { name: "详情页富文本内容" }).querySelectorAll("video")).toHaveLength(0);

    await act(async () => {
      lifecycle.current?.commands.insertContent({
        type: "assetVideo",
        attrs: { src: "/\\evil.invalid/direct.mp4", mediaAssetId: 910 }
      });
    });
    expect(lifecycle.current?.getHTML()).not.toContain("evil.invalid");
    expect(screen.getByRole("textbox", { name: "详情页富文本内容" }).querySelectorAll("video")).toHaveLength(0);
  });

  it("round-trips canonical remote media only when it carries a valid registered asset id", async () => {
    const lifecycle = editorObserver();
    const canonical =
      '<h1>媒体</h1>' +
      '<img src="https://assets.example.com/registered.webp" alt="对象存储图片" data-media-asset-id="808">' +
      '<video src="https://assets.example.com/registered.mp4" data-media-asset-id="809" controls preload="metadata"></video>';
    const { rerender } = render(
      <RichTextEditorField value={canonical} onChange={vi.fn()} lifecycleObserver={lifecycle.observer} />
    );

    await waitFor(() => {
      const html = lifecycle.current?.getHTML() ?? "";
      expect(html).toContain('src="https://assets.example.com/registered.webp"');
      expect(html).toContain('data-media-asset-id="808"');
      expect(html).toContain('src="https://assets.example.com/registered.mp4"');
      expect(html).toContain('data-media-asset-id="809"');
      expect(html).toContain("<h1>媒体</h1>");
    });

    await act(async () => {
      lifecycle.current?.commands.setContent(
        '<img src="https://evil.invalid/rebound.webp" data-media-asset-id="808">' +
        '<video src="/uploads/rebound.mp4" data-media-asset-id="809"></video>'
      );
    });
    await waitFor(() => {
      const html = lifecycle.current?.getHTML() ?? "";
      expect(html).not.toContain("evil.invalid");
      expect(html).not.toContain("rebound.mp4");
      expect(html).not.toMatch(/<img|<video/);
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

    rerender(<RichTextEditorField value="<h1>编辑回填</h1>" onChange={onChange} lifecycleObserver={lifecycle.observer} />);
    await waitFor(() => expect(lifecycle.current?.getHTML()).toBe("<h1>编辑回填</h1>"));
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
