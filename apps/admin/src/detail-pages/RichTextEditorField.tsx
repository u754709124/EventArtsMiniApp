import { useEffect, useRef, useState } from "react";
import { Button, message } from "antd";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { MediaAssetDto, MediaType } from "@event-arts/shared";
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
  );
}

function selectedBlockType(editor: Editor | null) {
  if (!editor) return "p";
  for (const level of [1, 2, 3, 4] as const) {
    if (editor.isActive("heading", { level })) return `h${level}`;
  }
  return "p";
}

function safeLinkHref(value: string) {
  const href = value.trim();
  return /^(?:https?:\/\/|mailto:|tel:)[^\s<>"']+$/i.test(href) ? href : null;
}

function emptyEquivalent(value: string) {
  return value.trim() ? value : "<p></p>";
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
  if (!extensionsRef.current) {
    extensionsRef.current = createRichTextEditorExtensions(trustedMediaRegistryRef.current);
  }

  const editor = useEditor(
    {
      extensions: extensionsRef.current,
      content: value,
      editable: !disabled,
      immediatelyRender: false,
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
      bulletList: instance?.isActive("bulletList") ?? false,
      orderedList: instance?.isActive("orderedList") ?? false,
      blockquote: instance?.isActive("blockquote") ?? false,
      link: instance?.isActive("link") ?? false,
      image: instance?.isActive("assetImage") ?? false,
      align: instance?.isActive({ textAlign: "center" })
        ? "center"
        : instance?.isActive({ textAlign: "right" })
          ? "right"
          : "left"
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
    const incoming = emptyEquivalent(value);
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(value, { emitUpdate: false, errorOnInvalidContent: false });
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
    bulletList: false,
    orderedList: false,
    blockquote: false,
    link: false,
    image: false,
    align: "left"
  };

  function setBlock(block: string) {
    if (!editor) return;
    if (block === "p") {
      editor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(block.slice(1));
    if ([1, 2, 3, 4].includes(level)) {
      editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 }).run();
    }
  }

  function setAlignment(align: "left" | "center" | "right") {
    if (!editor) return;
    if (editor.isActive("assetImage")) {
      editor.chain().focus().updateAttributes("assetImage", { align }).run();
      return;
    }
    editor.chain().focus().setTextAlign(align).run();
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
      message.warning("链接仅支持 http、https、mailto 或 tel 协议");
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
      message.warning(pickerType === "image" ? "请选择图片资源" : "请选择视频资源");
      return;
    }
    const mediaAssetId = normalizeMediaAssetId(asset.id);
    if (!mediaAssetId || !isSafeAssetMediaSource(asset.url, true)) {
      message.error("资源地址无效，请重新选择已登记资源");
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
        attrs: { src: asset.url, mediaAssetId, alt: asset.resourceName || "内容图片", align: null }
      });
    } else {
      insert({ type: "assetVideo", attrs: { src: asset.url, mediaAssetId, align: null } });
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

      <div className="rich-text-toolbar" role="toolbar" aria-label="富文本编辑工具栏">
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
            <option value="h2">标题 H2</option>
            <option value="h3">标题 H3</option>
            <option value="h4">标题 H4</option>
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

        <ToolbarButton label="粗体" disabled={unavailable} active={state.bold} onClick={() => editor?.chain().focus().toggleBold().run()}>B</ToolbarButton>
        <ToolbarButton label="斜体" disabled={unavailable} active={state.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <ToolbarButton label="下划线" disabled={unavailable} active={state.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
        <ToolbarButton label="删除线" disabled={unavailable} active={state.strike} onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
        <ToolbarButton label="左对齐" disabled={unavailable} active={state.align === "left"} onClick={() => setAlignment("left")}>左</ToolbarButton>
        <ToolbarButton label="居中" disabled={unavailable} active={state.align === "center"} onClick={() => setAlignment("center")}>中</ToolbarButton>
        <ToolbarButton label="右对齐" disabled={unavailable} active={state.align === "right"} onClick={() => setAlignment("right")}>右</ToolbarButton>
        <ToolbarButton label="有序列表" disabled={unavailable} active={state.orderedList} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
        <ToolbarButton label="无序列表" disabled={unavailable} active={state.bulletList} onClick={() => editor?.chain().focus().toggleBulletList().run()}>•</ToolbarButton>
        <ToolbarButton label="引用" disabled={unavailable} active={state.blockquote} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>引用</ToolbarButton>
        <ToolbarButton label="分割线" disabled={unavailable} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>—</ToolbarButton>
        <ToolbarButton label="添加链接" disabled={unavailable} active={state.link} onClick={editLink}>链接</ToolbarButton>
        <ToolbarButton label="插入图片" disabled={unavailable} onClick={() => setPickerType("image")}>图片</ToolbarButton>
        <ToolbarButton label="编辑图片替代文本" disabled={unavailable || !state.image} onClick={editImageAlt}>图片 ALT</ToolbarButton>
        <ToolbarButton label="插入视频" disabled={unavailable} onClick={() => setPickerType("video")}>视频</ToolbarButton>
        <ToolbarButton label="撤销" disabled={unavailable} onClick={() => editor?.chain().focus().undo().run()}>撤销</ToolbarButton>
        <ToolbarButton label="重做" disabled={unavailable} onClick={() => editor?.chain().focus().redo().run()}>重做</ToolbarButton>
        <ToolbarButton label="清除格式" disabled={unavailable} onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>清除格式</ToolbarButton>
      </div>

      <EditorContent editor={editor} />

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
