import { Extension, Node, mergeAttributes, type Extensions } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { MediaType } from "@event-arts/shared";

export type AssetAlignment = "left" | "center" | "right" | null;

const allowedRichTextClasses = new Set([
  "ea-detail-card",
  "ea-section-title",
  "ea-section-body",
  "ea-intro",
  "ea-advantage-grid",
  "ea-advantage-item",
  "ea-case-grid",
  "ea-case-item",
  "ea-process-row",
  "ea-process-item",
  "ea-review-list",
  "ea-review-item",
  "ea-review-main",
  "ea-review-image",
  "ea-two-column",
  "ea-calendar-card",
  "ea-faq-card",
  "ea-media",
  "ea-image",
  "ea-video",
  "ea-media-block",
  "ea-align-left",
  "ea-align-center",
  "ea-align-right"
]);

const safeStyleValue = /^(?!.*(?:expression|javascript|vbscript|url\s*\())[^{}<>]{1,160}$/i;
const lengthStyleValue = /^(?:0|auto|\d+(?:\.\d+)?(?:px|rpx|rem|em|%))(?:\s+(?:0|auto|\d+(?:\.\d+)?(?:px|rpx|rem|em|%))){0,3}$/i;
const colorStyleValue = /^(?:#[a-f\d]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%]+\)|[a-z]{1,24})$/i;

const allowedStyleValues: Record<string, RegExp> = {
  color: colorStyleValue,
  "background-color": colorStyleValue,
  "font-size": lengthStyleValue,
  "font-weight": /^(?:normal|bold|[1-9]00)$/i,
  "font-style": /^(?:normal|italic|oblique)$/i,
  "text-decoration": safeStyleValue,
  "text-align": /^(?:left|center|right|justify)$/i,
  "line-height": /^(?:normal|\d+(?:\.\d+)?(?:px|rpx|rem|em|%)?)$/i,
  margin: lengthStyleValue,
  padding: lengthStyleValue,
  border: safeStyleValue,
  "border-radius": lengthStyleValue,
  width: lengthStyleValue,
  "max-width": lengthStyleValue,
  height: lengthStyleValue,
  "max-height": lengthStyleValue
};

function styleValueWithinBounds(property: string, value: string) {
  if (property === "line-height" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value) <= 4;
  const limits = property === "font-size"
    ? { px: 96, rpx: 192, rem: 6, em: 6, "%": 300 }
    : ["width", "max-width", "height", "max-height"].includes(property)
      ? { px: 2000, rpx: 4000, rem: 125, em: 125, "%": 100 }
      : ["margin", "padding", "border-radius"].includes(property)
        ? { px: 240, rpx: 480, rem: 15, em: 15, "%": 100 }
        : property === "line-height"
          ? { px: 96, rpx: 192, rem: 6, em: 6, "%": 400 }
          : property === "border"
            ? { px: 20, rpx: 40, rem: 2, em: 2, "%": 0 }
            : null;
  if (!limits) return true;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(px|rpx|rem|em|%)/gi)) {
    const unit = match[2].toLocaleLowerCase("en-US") as keyof typeof limits;
    if (Number(match[1]) > limits[unit]) return false;
  }
  return true;
}

export function sanitizeRichTextClassName(value: unknown) {
  if (typeof value !== "string") return null;
  const classes = [...new Set(value.split(/\s+/).filter((name) => allowedRichTextClasses.has(name)))];
  return classes.length ? classes.join(" ") : null;
}

export function sanitizeRichTextStyle(value: unknown) {
  if (typeof value !== "string") return null;
  const declarations = value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .flatMap((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 1) return [];
      const property = declaration.slice(0, separator).trim().toLocaleLowerCase("en-US");
      const propertyValue = declaration.slice(separator + 1).trim();
      const validator = allowedStyleValues[property];
      if (!validator?.test(propertyValue) || !styleValueWithinBounds(property, propertyValue)) return [];
      return [`${property}: ${propertyValue}`];
    });
  return declarations.length ? declarations.join("; ") : null;
}

function safeHtmlAttributes(element: HTMLElement) {
  return {
    class: sanitizeRichTextClassName(element.getAttribute("class")),
    style: sanitizeRichTextStyle(element.getAttribute("style"))
  };
}

function safeAttributeDefinitions() {
  return {
    class: {
      default: null,
      parseHTML: (element: HTMLElement) => sanitizeRichTextClassName(element.getAttribute("class")),
      renderHTML: (attributes: Record<string, unknown>) => {
        const className = sanitizeRichTextClassName(attributes.class);
        return className ? { class: className } : {};
      }
    },
    style: {
      default: null,
      parseHTML: (element: HTMLElement) => sanitizeRichTextStyle(element.getAttribute("style")),
      renderHTML: (attributes: Record<string, unknown>) => {
        const style = sanitizeRichTextStyle(attributes.style);
        return style ? { style } : {};
      }
    }
  };
}

export function normalizeMediaAssetId(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeAssetMediaSource(source: unknown, allowRemote: boolean) {
  if (typeof source !== "string") return null;
  const value = source.trim();
  if (!value || /[\s<>"']/.test(value)) return null;
  if (value.includes("\\")) return null;
  if (/^(?:data:|blob:|file:|wxfile:)/i.test(value)) return null;
  if (/^(?:\/private)?\/tmp(?:\/|$)/i.test(value)) return null;
  try {
    if (/^https?:\/\//i.test(value)) {
      if (!allowRemote) return null;
      const url = new URL(value);
      if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) return null;
      return url.href;
    }
    if (!/^\/(?!\/)/.test(value)) return null;
    const localOrigin = "https://event-arts.invalid";
    const url = new URL(value, localOrigin);
    if (url.origin !== localOrigin || url.username || url.password) return null;
    let decodedPath = url.pathname;
    for (let index = 0; index < 5; index += 1) {
      const next = decodeURIComponent(decodedPath);
      if (next === decodedPath) break;
      decodedPath = next;
    }
    if (decodedPath.includes("\\")) return null;
    if (/^(?:\/private)?\/tmp(?:\/|$)/i.test(decodedPath)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function isSafeAssetMediaSource(source: unknown, allowRegisteredRemote = false) {
  return normalizeAssetMediaSource(source, allowRegisteredRemote) !== null;
}

type TrustedMediaPair = { mediaType: MediaType; mediaAssetId: number; src: string };

export type TrustedMediaRegistry = {
  syncControlledHtml: (html: string) => void;
  trustPickerAsset: (asset: TrustedMediaPair) => void;
  has: (asset: TrustedMediaPair) => boolean;
};

function trustedPairKey({ mediaType, mediaAssetId, src }: TrustedMediaPair) {
  const id = normalizeMediaAssetId(mediaAssetId);
  const normalizedSource = normalizeAssetMediaSource(src, true);
  return id && normalizedSource ? `${mediaType}:${id}:${normalizedSource}` : null;
}

function trustedPairsFromControlledHtml(html: string) {
  const pairs = new Set<string>();
  if (typeof document === "undefined") return pairs;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll("img[data-media-asset-id],video[data-media-asset-id]")) {
    const mediaAssetId = normalizeMediaAssetId(element.getAttribute("data-media-asset-id"));
    const src = element.getAttribute("src") ?? "";
    if (!mediaAssetId) continue;
    const key = trustedPairKey({ mediaType: element.tagName === "IMG" ? "image" : "video", mediaAssetId, src });
    if (key) pairs.add(key);
  }
  return pairs;
}

export function createTrustedMediaRegistry(): TrustedMediaRegistry {
  let controlledHtml: string | null = null;
  let controlledPairs = new Set<string>();
  const pickerPairs = new Set<string>();
  return {
    syncControlledHtml(html) {
      if (controlledHtml === html) return;
      controlledHtml = html;
      controlledPairs = trustedPairsFromControlledHtml(html);
      pickerPairs.clear();
    },
    trustPickerAsset(asset) {
      const key = trustedPairKey(asset);
      if (key) pickerPairs.add(key);
    },
    has(asset) {
      const key = trustedPairKey(asset);
      return key !== null && (controlledPairs.has(key) || pickerPairs.has(key));
    }
  };
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

function createAssetImage(registry: TrustedMediaRegistry) {
  return Node.create({
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
            const src = node.getAttribute("src") ?? "";
            const normalizedSrc = normalizeAssetMediaSource(src, true);
            if (!mediaAssetId || !normalizedSrc || !registry.has({ mediaType: "image", mediaAssetId, src })) {
              return false;
            }
            return {
              src: normalizedSrc,
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
      const normalizedSrc = normalizeAssetMediaSource(src, true);
      if (!mediaAssetId || !normalizedSrc || !registry.has({ mediaType: "image", mediaAssetId, src })) {
        return ["span", { class: "ea-media-invalid" }];
      }
      const align = (["left", "center", "right"] as const).includes(node.attrs.align) ? node.attrs.align : null;
      return [
        "img",
        mergeAttributes({
          src: normalizedSrc,
          alt: typeof node.attrs.alt === "string" && node.attrs.alt.trim() ? node.attrs.alt.trim() : "内容图片",
          "data-media-asset-id": String(mediaAssetId),
          class: mediaClass("image", align)
        })
      ];
    }
  });
}

function createAssetVideo(registry: TrustedMediaRegistry) {
  return Node.create({
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
            const src = node.getAttribute("src") ?? "";
            const normalizedSrc = normalizeAssetMediaSource(src, true);
            if (!mediaAssetId || !normalizedSrc || !registry.has({ mediaType: "video", mediaAssetId, src })) {
              return false;
            }
            return { src: normalizedSrc, mediaAssetId, align: readAlignment(node) };
          }
        }
      ];
    },

    renderHTML({ node }) {
      const mediaAssetId = normalizeMediaAssetId(node.attrs.mediaAssetId);
      const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
      const normalizedSrc = normalizeAssetMediaSource(src, true);
      if (!mediaAssetId || !normalizedSrc || !registry.has({ mediaType: "video", mediaAssetId, src })) {
        return ["span", { class: "ea-media-invalid" }];
      }
      const align = (["left", "center", "right"] as const).includes(node.attrs.align) ? node.attrs.align : null;
      return [
        "video",
        mergeAttributes({
          src: normalizedSrc,
          "data-media-asset-id": String(mediaAssetId),
          class: mediaClass("video", align),
          controls: "",
          preload: "metadata"
        })
      ];
    }
  });
}

const SafeSection = Node.create({
  name: "safeSection",
  group: "block",
  content: "block*",
  defining: true,
  addAttributes: safeAttributeDefinitions,
  parseHTML() {
    return [{ tag: "section", getAttrs: (node) => safeHtmlAttributes(node as HTMLElement) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["section", mergeAttributes(HTMLAttributes), 0];
  }
});

const SafeDiv = Node.create({
  name: "safeDiv",
  group: "block",
  content: "block*",
  defining: true,
  addAttributes: safeAttributeDefinitions,
  parseHTML() {
    return [{ tag: "div", getAttrs: (node) => safeHtmlAttributes(node as HTMLElement) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  }
});

const SafeStrongBlock = Node.create({
  name: "safeStrongBlock",
  group: "block",
  content: "inline*",
  addAttributes: safeAttributeDefinitions,
  parseHTML() {
    return [
      {
        tag: "strong",
        context: "safeDiv/|safeSection/",
        priority: 200,
        getAttrs: (node) => safeHtmlAttributes(node as HTMLElement)
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["strong", mergeAttributes(HTMLAttributes), 0];
  }
});

const SafeTextStyle = TextStyle.extend({
  addAttributes: safeAttributeDefinitions,
  parseHTML() {
    return [{ tag: "span", getAttrs: (node) => safeHtmlAttributes(node as HTMLElement) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  }
});

const SafeTemplateAttributes = Extension.create({
  name: "safeTemplateAttributes",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "bulletList",
          "orderedList",
          "listItem",
          "blockquote",
          "horizontalRule",
          "bold",
          "italic",
          "underline",
          "strike",
          "link"
        ],
        attributes: safeAttributeDefinitions()
      }
    ];
  }
});

export function createRichTextEditorExtensions(registry: TrustedMediaRegistry): Extensions {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: false,
      trailingNode: false,
      underline: false
    }),
    SafeSection,
    SafeDiv,
    SafeStrongBlock,
    SafeTextStyle,
    SafeTemplateAttributes,
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
    createAssetImage(registry),
    createAssetVideo(registry)
  ];
}
