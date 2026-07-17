import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "antd";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { MediaAssetDto, MediaType } from "@event-arts/shared";
import { notify } from "../notifications/notification";
import { MediaPickerModal } from "./MediaPickerModal";
import {
  createRichTextEditorExtensions,
  createTrustedMediaRegistry,
  isSafeAssetMediaSource,
  normalizeMediaAssetId,
  type TrustedMediaRegistry
} from "./RichTextEditorExtensions";
import "./rich-text-editor.css";

export {
  isSafeAssetMediaSource,
  normalizeMediaAssetId,
  sanitizeRichTextClassName,
  sanitizeRichTextStyle
} from "./RichTextEditorExtensions";

export type RichTextEditorLifecycleObserver = {
  onCreate?: (editor: Editor) => void;
  onDestroy?: (editor: Editor) => void;
};

export type RichTextEditorFieldProps = {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  lifecycleObserver?: RichTextEditorLifecycleObserver;
};

type ToolbarButtonProps = {
  label: string;
  disabled: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function ToolbarButton({ label, disabled, active, onClick, children }: ToolbarButtonProps) {
  return (
    <Tooltip title={label}>
      <Button
        className={active ? "rich-text-toolbar-button is-active" : "rich-text-toolbar-button"}
        disabled={disabled}
        aria-label={label}
        aria-pressed={typeof active === "boolean" ? active : undefined}
        title={label}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function selectedBlockType(editor: Editor | null) {
  if (!editor) return "p";
  if (editor.isActive("heading", { level: 1 })) return "h1";
  return "p";
}

function safeLinkHref(value: string) {
  const href = value.trim();
  return /^(?:https?:\/\/|mailto:|tel:)[^\s<>"']+$/i.test(href) ? href : null;
}

function emptyEquivalent(value: string) {
  return value.trim() ? value : "<p></p>";
}

const richTextParseOptions = { preserveWhitespace: "full" as const };

function removeUntrustedControlledMedia(html: string, registry: TrustedMediaRegistry) {
  if (typeof document === "undefined" || !html) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll("img, video")) {
    const mediaType = element.tagName === "IMG" ? "image" : "video";
    const mediaAssetId = normalizeMediaAssetId(element.getAttribute("data-media-asset-id"));
    const src = element.getAttribute("src") ?? "";
    if (!mediaAssetId || !registry.has({ mediaType, mediaAssetId, src })) element.remove();
  }
  return template.innerHTML;
}

export function RichTextEditorField({
  value = "",
  onChange,
  disabled = false,
  lifecycleObserver
}: RichTextEditorFieldProps) {
  const onChangeRef = useRef(onChange);
  const lifecycleObserverRef = useRef(lifecycleObserver);
  const controlledValueRef = useRef(value);
  const trustedMediaRegistryRef = useRef<TrustedMediaRegistry | null>(null);
  const extensionsRef = useRef<ReturnType<typeof createRichTextEditorExtensions> | null>(null);
  onChangeRef.current = onChange;
  lifecycleObserverRef.current = lifecycleObserver;
  controlledValueRef.current = value;
  if (!trustedMediaRegistryRef.current) trustedMediaRegistryRef.current = createTrustedMediaRegistry();
  // Trust only API-loaded or MediaAsset-hydrated controlled HTML; arbitrary editor input never seeds this registry.
  trustedMediaRegistryRef.current.syncControlledHtml(value);
  const controlledEditorHtml = removeUntrustedControlledMedia(value, trustedMediaRegistryRef.current);
  if (!extensionsRef.current) {
    extensionsRef.current = createRichTextEditorExtensions(trustedMediaRegistryRef.current);
  }

  const editor = useEditor(
    {
      extensions: extensionsRef.current,
      content: controlledEditorHtml,
      editable: !disabled,
      immediatelyRender: false,
      parseOptions: richTextParseOptions,
      editorProps: {
        attributes: {
          "aria-label": "详情页富文本内容",
          "aria-describedby": "detail-rich-text-help",
          "aria-multiline": "true",
          class: "rich-text-editor-content",
          role: "textbox"
        }
      },
      onCreate: ({ editor: instance }) => {
        lifecycleObserverRef.current?.onCreate?.(instance);
        instance.once("destroy", () => lifecycleObserverRef.current?.onDestroy?.(instance));
      },
      onUpdate: ({ editor: instance }) => {
        const html = instance.getHTML();
        if (html !== emptyEquivalent(controlledValueRef.current)) onChangeRef.current?.(html);
      }
    },
    []
  );

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      block: selectedBlockType(instance),
      color: instance?.getAttributes("textStyle").color as string | undefined,
      fontSize: instance?.getAttributes("textStyle").fontSize as string | undefined,
      bold: instance?.isActive("bold") ?? false,
      italic: instance?.isActive("italic") ?? false,
      underline: instance?.isActive("underline") ?? false,
      strike: instance?.isActive("strike") ?? false,
      link: instance?.isActive("link") ?? false,
      image: instance?.isActive("assetImage") ?? false,
      bulletList: instance?.isActive("bulletList") ?? false,
      orderedList: instance?.isActive("orderedList") ?? false,
      blockquote: instance?.isActive("blockquote") ?? false,
      textAlign: (instance?.getAttributes("paragraph").textAlign || instance?.getAttributes("heading").textAlign || "left") as string
    })
  });

  const [pickerType, setPickerType] = useState<MediaType | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled);
    if (disabled) setPickerType(null);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incomingHtml = removeUntrustedControlledMedia(value, trustedMediaRegistryRef.current!);
    const incoming = emptyEquivalent(incomingHtml);
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(incomingHtml, {
        emitUpdate: false,
        errorOnInvalidContent: false,
        parseOptions: richTextParseOptions
      });
    }
  }, [editor, value]);

  const unavailable = disabled || !editor;
  const state = toolbarState ?? {
    block: "p",
    color: undefined,
    fontSize: undefined,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    link: false,
    image: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    textAlign: "left"
  };

  function setBlock(block: string) {
    if (!editor) return;
    if (block === "p") {
      editor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(block.slice(1));
    if (level === 1) {
      editor.chain().focus().setHeading({ level }).run();
    }
  }

  function editLink() {
    if (!editor) return;
    const current = editor.getAttributes("link").href as string | undefined;
    const input = window.prompt("请输入完整链接（http、https、mailto 或 tel）", current ?? "https://");
    if (input === null) return;
    if (!input.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const href = safeLinkHref(input);
    if (!href) {
      notify.warning("链接仅支持 http、https、mailto 或 tel 协议");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }

  function editImageAlt() {
    if (!editor?.isActive("assetImage")) return;
    const current = (editor.getAttributes("assetImage").alt as string | undefined) ?? "内容图片";
    const next = window.prompt("请输入图片替代文本", current);
    if (next === null) return;
    editor.chain().focus().updateAttributes("assetImage", { alt: next.trim() || "内容图片" }).run();
  }

  function insertAsset(asset: MediaAssetDto) {
    if (!editor || !pickerType) return;
    if (asset.mediaType !== pickerType) {
      notify.warning(pickerType === "image" ? "请选择图片资源" : "请选择视频资源");
      return;
    }
    const mediaAssetId = normalizeMediaAssetId(asset.id);
    if (!mediaAssetId || !isSafeAssetMediaSource(asset.url, true)) {
      notify.error("资源地址无效，请重新选择已登记资源");
      return;
    }
    trustedMediaRegistryRef.current?.trustPickerAsset({
      mediaType: asset.mediaType,
      mediaAssetId,
      src: asset.url
    });
    const selection = editor.state.selection;
    const selectedNodeName =
      "node" in selection
        ? (selection as { node?: { type?: { name?: unknown } } }).node?.type?.name
        : undefined;
    const shouldAppendAfterSelectedMedia =
      typeof selectedNodeName === "string" && ["assetImage", "assetVideo"].includes(selectedNodeName);
    const insert = (content: Parameters<ReturnType<Editor["chain"]>["insertContent"]>[0]) => {
      const chain = editor.chain().focus();
      if (shouldAppendAfterSelectedMedia) {
        chain.insertContentAt(selection.to, content).run();
        return;
      }
      chain.insertContent(content).run();
    };
    if (asset.mediaType === "image") {
      insert({
        type: "assetImage",
        attrs: { src: asset.url, mediaAssetId, alt: asset.resourceName || "内容图片" }
      });
    } else {
      insert({ type: "assetVideo", attrs: { src: asset.url, mediaAssetId } });
    }
    setPickerType(null);
  }

  return (
    <section data-testid="detail-rich-text-editor" className={disabled ? "rich-text-editor is-disabled" : "rich-text-editor"}>
      <div className="rich-text-editor-heading">
        <span className="rich-text-editor-label">详情页富文本</span>
        <span id="detail-rich-text-help" className="rich-text-editor-help">
          图片与视频须从资源库选择，内容会在保存时再次安全清洗。
        </span>
      </div>

      <div className="rich-text-editor-frame" data-testid="detail-rich-text-frame">
        <div className="rich-text-toolbar" role="toolbar" aria-label="富文本编辑工具栏" data-testid="detail-rich-text-toolbar">
          <div className="rich-text-toolbar-group" aria-label="文本样式">
            <label className="rich-text-select-label">
              <span>段落与标题</span>
              <select
                aria-label="段落与标题"
                value={state.block}
                disabled={unavailable}
                onChange={(event) => setBlock(event.target.value)}
              >
                <option value="p">正文 P</option>
                <option value="h1">标题 H1</option>
              </select>
            </label>

            <label className="rich-text-select-label">
              <span>字号</span>
              <select
                aria-label="字号"
                value={state.fontSize ?? ""}
                disabled={unavailable}
                onChange={(event) => {
                  if (!editor) return;
                  const chain = editor.chain().focus();
                  if (event.target.value) chain.setFontSize(event.target.value).run();
                  else chain.unsetFontSize().run();
                }}
              >
                <option value="">默认字号</option>
                <option value="12px">12</option>
                <option value="14px">14</option>
                <option value="16px">16</option>
                <option value="18px">18</option>
                <option value="24px">24</option>
                <option value="32px">32</option>
              </select>
            </label>

            <label className="rich-text-color-label">
              <span>文字颜色</span>
              <input
                type="color"
                aria-label="文字颜色"
                value={state.color ?? "#262626"}
                disabled={unavailable}
                onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()}
              />
            </label>
          </div>
          <div className="rich-text-toolbar-group" aria-label="行内格式">
            <ToolbarButton label="粗体" disabled={unavailable} active={state.bold} onClick={() => editor?.chain().focus().toggleBold().run()}>B</ToolbarButton>
            <ToolbarButton label="斜体" disabled={unavailable} active={state.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
            <ToolbarButton label="下划线" disabled={unavailable} active={state.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
            <ToolbarButton label="删除线" disabled={unavailable} active={state.strike} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
          </div>
          <div className="rich-text-toolbar-group" aria-label="排版">
            <ToolbarButton label="左对齐" disabled={unavailable} active={state.textAlign === "left"} onClick={() => editor?.chain().focus().setTextAlign("left").run()}>左</ToolbarButton>
            <ToolbarButton label="居中" disabled={unavailable} active={state.textAlign === "center"} onClick={() => editor?.chain().focus().setTextAlign("center").run()}>中</ToolbarButton>
            <ToolbarButton label="右对齐" disabled={unavailable} active={state.textAlign === "right"} onClick={() => editor?.chain().focus().setTextAlign("right").run()}>右</ToolbarButton>
            <ToolbarButton label="有序列表" disabled={unavailable} active={state.orderedList} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
            <ToolbarButton label="无序列表" disabled={unavailable} active={state.bulletList} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</ToolbarButton>
            <ToolbarButton label="引用" disabled={unavailable} active={state.blockquote} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>引</ToolbarButton>
            <ToolbarButton label="分割线" disabled={unavailable} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>线</ToolbarButton>
          </div>
          <div className="rich-text-toolbar-group" aria-label="链接与媒体">
            <ToolbarButton label="添加链接" disabled={unavailable} active={state.link} onClick={editLink}>链接</ToolbarButton>
            <ToolbarButton label="插入图片" disabled={unavailable} onClick={() => setPickerType("image")}>图片</ToolbarButton>
            <ToolbarButton label="编辑图片替代文本" disabled={unavailable || !state.image} onClick={editImageAlt}>图片 ALT</ToolbarButton>
            <ToolbarButton label="插入视频" disabled={unavailable} onClick={() => setPickerType("video")}>视频</ToolbarButton>
          </div>
          <div className="rich-text-toolbar-group" aria-label="历史记录">
            <ToolbarButton label="撤销" disabled={unavailable} onClick={() => editor?.chain().focus().undo().run()}>撤销</ToolbarButton>
            <ToolbarButton label="重做" disabled={unavailable} onClick={() => editor?.chain().focus().redo().run()}>重做</ToolbarButton>
          </div>
          <div className="rich-text-toolbar-group" aria-label="更多">
            <ToolbarButton label="清除格式" disabled={unavailable} onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>清除格式</ToolbarButton>
          </div>
        </div>

        <EditorContent editor={editor} />
      </div>

      <MediaPickerModal
        open={pickerType !== null}
        fieldKey="detail.richText"
        allowedTypes={pickerType ? [pickerType] : ["image", "video"]}
        testid="detail-rich-text-media-picker"
        onCancel={() => setPickerType(null)}
        onSelect={insertAsset}
      />
    </section>
  );
}
