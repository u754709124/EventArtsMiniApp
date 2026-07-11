import { Node, mergeAttributes, type Extensions } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

export type AssetAlignment = "left" | "center" | "right" | null;

export function normalizeMediaAssetId(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isSafeAssetMediaSource(source: unknown, allowRegisteredRemote = false) {
  if (typeof source !== "string") return false;
  const value = source.trim();
  if (!value || /[\s<>"']/.test(value)) return false;
  if (/^(?:data:|blob:|file:|wxfile:)/i.test(value)) return false;
  if (/^(?:\/private)?\/tmp(?:\/|$)/i.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return allowRegisteredRemote;
  return /^\/(?!\/)/.test(value);
}

function readAlignment(element: HTMLElement): AssetAlignment {
  if (element.classList.contains("ea-align-left")) return "left";
  if (element.classList.contains("ea-align-center")) return "center";
  if (element.classList.contains("ea-align-right")) return "right";
  return null;
}

function mediaClass(kind: "image" | "video", alignment: AssetAlignment) {
  return ["ea-media", `ea-${kind}`, alignment ? `ea-align-${alignment}` : null].filter(Boolean).join(" ");
}

export const AssetImage = Node.create({
  name: "assetImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      mediaAssetId: { default: null },
      alt: { default: "内容图片" },
      align: { default: null }
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[data-media-asset-id]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const mediaAssetId = normalizeMediaAssetId(node.getAttribute("data-media-asset-id"));
          const src = node.getAttribute("src");
          if (!mediaAssetId || !isSafeAssetMediaSource(src, true)) return false;
          return {
            src,
            mediaAssetId,
            alt: node.getAttribute("alt")?.trim() || "内容图片",
            align: readAlignment(node)
          };
        }
      }
    ];
  },

  renderHTML({ node }) {
    const mediaAssetId = normalizeMediaAssetId(node.attrs.mediaAssetId);
    const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
    if (!mediaAssetId || !isSafeAssetMediaSource(src, true)) return ["span", { class: "ea-media-invalid" }];
    const align = (["left", "center", "right"] as const).includes(node.attrs.align) ? node.attrs.align : null;
    return [
      "img",
      mergeAttributes({
        src,
        alt: typeof node.attrs.alt === "string" && node.attrs.alt.trim() ? node.attrs.alt.trim() : "内容图片",
        "data-media-asset-id": String(mediaAssetId),
        class: mediaClass("image", align)
      })
    ];
  }
});

export const AssetVideo = Node.create({
  name: "assetVideo",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      src: { default: null },
      mediaAssetId: { default: null },
      align: { default: null }
    };
  },

  parseHTML() {
    return [
      {
        tag: "video[data-media-asset-id]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const mediaAssetId = normalizeMediaAssetId(node.getAttribute("data-media-asset-id"));
          const src = node.getAttribute("src");
          if (!mediaAssetId || !isSafeAssetMediaSource(src, true)) return false;
          return { src, mediaAssetId, align: readAlignment(node) };
        }
      }
    ];
  },

  renderHTML({ node }) {
    const mediaAssetId = normalizeMediaAssetId(node.attrs.mediaAssetId);
    const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
    if (!mediaAssetId || !isSafeAssetMediaSource(src, true)) return ["span", { class: "ea-media-invalid" }];
    const align = (["left", "center", "right"] as const).includes(node.attrs.align) ? node.attrs.align : null;
    return [
      "video",
      mergeAttributes({
        src,
        "data-media-asset-id": String(mediaAssetId),
        class: mediaClass("video", align),
        controls: "",
        preload: "metadata"
      })
    ];
  }
});

export const richTextEditorExtensions: Extensions = [
  StarterKit.configure({
    code: false,
    codeBlock: false,
    heading: { levels: [1, 2, 3, 4] },
    link: false,
    trailingNode: false,
    underline: false
  }),
  TextStyle,
  FontSize,
  Color,
  Underline,
  Link.configure({
    autolink: false,
    linkOnPaste: false,
    openOnClick: false,
    protocols: ["http", "https", "mailto", "tel"],
    HTMLAttributes: { rel: "noopener noreferrer" },
    isAllowedUri: (url, context) => context.defaultValidate(url)
  }),
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
  AssetImage,
  AssetVideo
];
