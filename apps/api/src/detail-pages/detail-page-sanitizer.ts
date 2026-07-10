import sanitizeHtml from "sanitize-html";
import { parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import type { MediaType } from "@event-arts/shared";
import { DetailPageValidationError, type DetailPageMediaAsset } from "./detail-page-types";

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

const allowedTags = [
  "p",
  "div",
  "section",
  "span",
  "strong",
  "em",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "a",
  "img",
  "video",
  "source"
] as const;

const allowedClasses = [
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
] as const;

const safeStyleValue = /^(?!.*(?:expression|javascript|vbscript|url\s*\())[^{}<>]{1,160}$/i;
const lengthStyleValue = /^(?:0|auto|\d+(?:\.\d+)?(?:px|rpx|rem|em|%))(?:\s+(?:0|auto|\d+(?:\.\d+)?(?:px|rpx|rem|em|%))){0,3}$/i;
const colorStyleValue = /^(?:#[a-f\d]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%]+\)|[a-z]{1,24})$/i;

const allowedStyles = {
  "*": {
    color: [colorStyleValue],
    "background-color": [colorStyleValue],
    "font-size": [lengthStyleValue],
    "font-weight": [/^(?:normal|bold|[1-9]00)$/i],
    "font-style": [/^(?:normal|italic|oblique)$/i],
    "text-decoration": [safeStyleValue],
    "text-align": [/^(?:left|center|right|justify)$/i],
    "line-height": [/^(?:normal|\d+(?:\.\d+)?(?:px|rpx|rem|em|%)?)$/i],
    margin: [lengthStyleValue],
    padding: [lengthStyleValue],
    border: [safeStyleValue],
    "border-radius": [lengthStyleValue],
    width: [lengthStyleValue],
    "max-width": [lengthStyleValue],
    height: [lengthStyleValue],
    "max-height": [lengthStyleValue]
  }
};

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function isTextNode(node: ChildNode): node is DefaultTreeAdapterTypes.TextNode {
  return !isElement(node) && node.nodeName === "#text";
}

function walk(parent: { childNodes: ChildNode[] }, visitor: (element: Element) => void) {
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue;
    visitor(child);
    walk(child, visitor);
  }
}

function getAttribute(element: Element, name: string) {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function setAttributes(element: Element, attributes: Array<{ name: string; value: string }>) {
  element.attrs = attributes.map((attribute) => ({ ...attribute, namespace: undefined, prefix: undefined }));
}

function mediaAssetId(element: Element) {
  const raw = getAttribute(element, "data-media-asset-id")?.trim() ?? "";
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new DetailPageValidationError(`${element.tagName === "img" ? "图片" : "视频"}节点缺少合法媒体资源 ID`);
  }
  return Number(raw);
}

function assertNoTemporaryMediaSource(rawHtml: string) {
  const fragment = parseFragment(rawHtml);
  walk(fragment, (element) => {
    if (!(["img", "video", "source"] as string[]).includes(element.tagName)) return;
    const source = (getAttribute(element, "src") ?? "").trim().toLocaleLowerCase("en-US");
    if (/^(?:data:|blob:|file:|wxfile:)/.test(source) || /^(?:\/private)?\/tmp\//.test(source)) {
      throw new DetailPageValidationError("富文本媒体不能使用 base64、blob、file 或本机临时地址");
    }
  });
}

function hasMeaningfulNode(parent: { childNodes: ChildNode[] }, includeVideo: boolean): boolean {
  for (const child of parent.childNodes) {
    if (isTextNode(child) && child.value.replace(/[\s\u3000\u200b\u00a0]/g, "")) return true;
    if (!isElement(child)) continue;
    if (child.tagName === "img" || (includeVideo && child.tagName === "video")) return true;
    if (hasMeaningfulNode(child, includeVideo)) return true;
  }
  return false;
}

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

function normalizeBoundedStyles(fragment: DefaultTreeAdapterTypes.DocumentFragment) {
  walk(fragment, (element) => {
    const styleAttribute = element.attrs.find((attribute) => attribute.name === "style");
    if (!styleAttribute) return;
    const declarations = styleAttribute.value
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .flatMap((declaration) => {
        const separator = declaration.indexOf(":");
        if (separator < 1) return [];
        const property = declaration.slice(0, separator).trim().toLocaleLowerCase("en-US");
        const value = declaration.slice(separator + 1).trim();
        return styleValueWithinBounds(property, value) ? [`${property}:${value}`] : [];
      });
    if (declarations.length) styleAttribute.value = declarations.join(";");
    else element.attrs = element.attrs.filter((attribute) => attribute !== styleAttribute);
  });
}

export function hasRenderableRichTextHtml(html: string) {
  return hasMeaningfulNode(parseFragment(html), false);
}

function normalizeMediaElements(
  fragment: DefaultTreeAdapterTypes.DocumentFragment,
  assets: ReadonlyMap<number, DetailPageMediaAsset>
) {
  walk(fragment, (element) => {
    if (element.tagName !== "img" && element.tagName !== "video") return;
    const assetId = mediaAssetId(element);
    const asset = assets.get(assetId);
    if (!asset) throw new DetailPageValidationError(`媒体资源 ${assetId} 不存在`);
    const expectedType: MediaType = element.tagName === "img" ? "image" : "video";
    if (asset.mediaType !== expectedType) {
      throw new DetailPageValidationError(
        `${element.tagName === "img" ? "图片节点只能引用图片资源" : "视频节点只能引用视频资源"}`
      );
    }

    const alignment = (getAttribute(element, "class") ?? "")
      .split(/\s+/)
      .find((name) => ["ea-align-left", "ea-align-center", "ea-align-right"].includes(name));
    const style = getAttribute(element, "style");
    if (element.tagName === "img") {
      const alt = getAttribute(element, "alt") ?? "内容图片";
      setAttributes(element, [
        { name: "src", value: asset.url },
        { name: "data-media-asset-id", value: String(assetId) },
        { name: "class", value: ["ea-media", "ea-image", alignment].filter(Boolean).join(" ") },
        { name: "alt", value: alt },
        ...(style ? [{ name: "style", value: style }] : [])
      ]);
      return;
    }

    setAttributes(element, [
      { name: "src", value: asset.url },
      { name: "data-media-asset-id", value: String(assetId) },
      { name: "class", value: ["ea-media", "ea-video", alignment].filter(Boolean).join(" ") },
      { name: "controls", value: "" },
      { name: "preload", value: "metadata" },
      ...(style ? [{ name: "style", value: style }] : [])
    ]);
    element.childNodes = element.childNodes.filter((child) => !isElement(child) || child.tagName !== "source");
  });
}

export function sanitizeAndNormalizeRichText(
  rawHtml: string,
  assets: ReadonlyMap<number, DetailPageMediaAsset>
) {
  assertNoTemporaryMediaSource(rawHtml);
  const sanitized = sanitizeHtml(rawHtml, {
    allowedTags: [...allowedTags],
    allowedAttributes: {
      "*": ["class", "style"],
      a: ["href", "target", "rel", "title", "class", "style"],
      img: ["src", "alt", "width", "height", "data-media-asset-id", "class", "style"],
      video: ["src", "poster", "width", "height", "controls", "preload", "data-media-asset-id", "class", "style"],
      source: ["src", "type"]
    },
    allowedClasses: { "*": [...allowedClasses] },
    allowedStyles,
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true
  });
  const fragment = parseFragment(sanitized);
  normalizeBoundedStyles(fragment);
  normalizeMediaElements(fragment, assets);
  if (!hasMeaningfulNode(fragment, true)) {
    throw new DetailPageValidationError("富文本详情不能为空");
  }
  return serialize(fragment).trim();
}

export function extractRichTextMedia(html: string) {
  const fragment = parseFragment(html);
  const seen = new Set<number>();
  const media: Array<{ assetId: number; mediaType: MediaType }> = [];
  walk(fragment, (element) => {
    if (element.tagName !== "img" && element.tagName !== "video") return;
    const assetId = mediaAssetId(element);
    if (seen.has(assetId)) return;
    seen.add(assetId);
    media.push({ assetId, mediaType: element.tagName === "img" ? "image" : "video" });
  });
  return media;
}

export function collectRichTextMediaAssetIds(html: string) {
  const ids = new Set<number>();
  const fragment = parseFragment(html);
  walk(fragment, (element) => {
    if (element.tagName !== "img" && element.tagName !== "video") return;
    const raw = getAttribute(element, "data-media-asset-id")?.trim() ?? "";
    if (/^\d+$/.test(raw) && Number(raw) > 0) ids.add(Number(raw));
  });
  return [...ids];
}

export function attachParentNodes(parent: ParentNode) {
  for (const child of parent.childNodes) {
    child.parentNode = parent;
    if (isElement(child)) attachParentNodes(child);
  }
}
