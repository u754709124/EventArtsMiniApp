import sanitizeHtml from "sanitize-html";
import { html, parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
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

function createText(value: string): DefaultTreeAdapterTypes.TextNode {
  return { nodeName: "#text", value, parentNode: null };
}

function createElement(tagName: string, attrs: Array<{ name: string; value: string }> = [], childNodes: ChildNode[] = []): Element {
  return {
    nodeName: tagName,
    tagName,
    attrs: attrs.map((attribute) => ({ ...attribute, namespace: undefined, prefix: undefined })),
    namespaceURI: html.NS.HTML,
    parentNode: null,
    childNodes
  };
}

function serializeNodes(nodes: ChildNode[]) {
  const fragment: DefaultTreeAdapterTypes.DocumentFragment = {
    nodeName: "#document-fragment",
    childNodes: nodes
  };
  attachParentNodes(fragment);
  return serialize(fragment).trim();
}

function textContent(node: ChildNode): string {
  if (isTextNode(node)) return node.value;
  if (!isElement(node)) return "";
  return node.childNodes.map((child) => textContent(child)).join("");
}

function compactText(value: string) {
  return value.replace(/[\s\u3000\u00a0]+/g, " ").trim();
}

function hasClass(element: Element, className: string) {
  return (getAttribute(element, "class") ?? "").split(/\s+/).includes(className);
}

function isHeading(element: Element) {
  return /^h[1-6]$/i.test(element.tagName);
}

function cloneInlineNode(node: ChildNode): ChildNode[] {
  if (isTextNode(node)) return [createText(node.value)];
  if (!isElement(node)) return [];
  if (node.tagName === "br") return [createElement("br")];
  const inlineTags = new Set(["strong", "em", "u", "s", "a", "span"]);
  if (!inlineTags.has(node.tagName)) return [];
  const children = node.childNodes.flatMap((child) => cloneInlineNode(child));
  const attrs: Array<{ name: string; value: string }> = [];
  if (node.tagName === "a") {
    const href = getAttribute(node, "href");
    if (href) {
      attrs.push({ name: "href", value: href });
      attrs.push({ name: "rel", value: "noopener noreferrer" });
      if (getAttribute(node, "target") === "_blank") attrs.push({ name: "target", value: "_blank" });
      const title = getAttribute(node, "title");
      if (title) attrs.push({ name: "title", value: title });
    }
  }
  if (node.tagName === "span") {
    const style = getAttribute(node, "style");
    if (style) attrs.push({ name: "style", value: style });
  }
  return [createElement(node.tagName, attrs, children)];
}

function inlineChildren(element: Element) {
  return element.childNodes.flatMap((child) => cloneInlineNode(child));
}

function hasRenderableInline(nodes: ChildNode[]) {
  const html = serializeNodes(nodes);
  return Boolean(
    html
      .replace(/<br\s*\/?>/giu, "")
      .replace(/<[^>]*>/gu, "")
      .replace(/&(?:nbsp|#160|#xA0);/giu, " ")
      .replace(/\s/gu, "")
  );
}

function appendParagraph(nodes: ChildNode[], output: ChildNode[]) {
  if (hasRenderableInline(nodes)) output.push(createElement("p", [], nodes));
}

function canonicalMediaElement(element: Element, assets: ReadonlyMap<number, DetailPageMediaAsset>) {
  const assetId = mediaAssetId(element);
  const asset = assets.get(assetId);
  if (!asset) throw new DetailPageValidationError(`媒体资源 ${assetId} 不存在`);
  const expectedType: MediaType = element.tagName === "img" ? "image" : "video";
  if (asset.mediaType !== expectedType) {
    throw new DetailPageValidationError(
      `${element.tagName === "img" ? "图片节点只能引用图片资源" : "视频节点只能引用视频资源"}`
    );
  }
  if (element.tagName === "img") {
    return createElement("img", [
      { name: "src", value: asset.url },
      { name: "data-media-asset-id", value: String(assetId) },
      { name: "alt", value: getAttribute(element, "alt") ?? "内容图片" }
    ]);
  }
  return createElement("video", [
    { name: "src", value: asset.url },
    { name: "data-media-asset-id", value: String(assetId) },
    { name: "controls", value: "" },
    { name: "preload", value: "metadata" }
  ]);
}

function appendCanonicalContent(
  node: ChildNode,
  output: ChildNode[],
  assets: ReadonlyMap<number, DetailPageMediaAsset>,
  skipNode?: ChildNode
) {
  if (node === skipNode) return;
  if (isTextNode(node)) {
    appendParagraph([createText(node.value)], output);
    return;
  }
  if (!isElement(node)) return;
  if (node.tagName === "img" || node.tagName === "video") {
    output.push(canonicalMediaElement(node, assets));
    return;
  }
  if (node.tagName === "br") {
    output.push(createElement("br"));
    return;
  }
  const paragraphTags = new Set(["p", "li", "blockquote", "h2", "h3", "h4", "h5", "h6"]);
  const directInline = inlineChildren(node);
  if (paragraphTags.has(node.tagName) || directInline.length) appendParagraph(directInline, output);
  for (const child of node.childNodes) {
    if (child === skipNode) continue;
    if (!isElement(child)) continue;
    if (child.tagName === "img" || child.tagName === "video" || child.tagName === "br") {
      appendCanonicalContent(child, output, assets, skipNode);
      continue;
    }
    if (["div", "section", "ul", "ol", "li", "blockquote", "p", "h2", "h3", "h4", "h5", "h6"].includes(child.tagName)) {
      appendCanonicalContent(child, output, assets, skipNode);
    }
  }
}

function readableTitleFrom(nodes: ChildNode[]) {
  const title = compactText(nodes.map((node) => textContent(node)).join("")).slice(0, 24);
  return title || "内容";
}

function legacyCards(parent: { childNodes: ChildNode[] }): Element[] {
  const cards: Element[] = [];
  const visit = (node: ChildNode) => {
    if (!isElement(node)) return;
    if (hasClass(node, "ea-detail-card")) {
      cards.push(node);
      return;
    }
    node.childNodes.forEach(visit);
  };
  parent.childNodes.forEach(visit);
  return cards;
}

function firstHeading(parent: { childNodes: ChildNode[] }) {
  let found: Element | null = null;
  const visit = (node: ChildNode) => {
    if (found || !isElement(node)) return;
    if (isHeading(node)) {
      found = node;
      return;
    }
    node.childNodes.forEach(visit);
  };
  parent.childNodes.forEach(visit);
  return found;
}

function canonicalCard(title: string, nodes: ChildNode[], assets: ReadonlyMap<number, DetailPageMediaAsset>, skipTitle?: Element) {
  const cardNodes: ChildNode[] = [createElement("h1", [], [createText(compactText(title) || readableTitleFrom(nodes))])];
  for (const node of nodes) {
    appendCanonicalContent(node, cardNodes, assets, skipTitle);
  }
  return cardNodes;
}

function normalizeFragmentToCards(
  fragment: DefaultTreeAdapterTypes.DocumentFragment,
  assets: ReadonlyMap<number, DetailPageMediaAsset>
) {
  const oldCards = legacyCards(fragment);
  if (oldCards.length) {
    return oldCards.flatMap((card) => {
      const heading = firstHeading(card);
      return canonicalCard(heading ? textContent(heading) : readableTitleFrom(card.childNodes), card.childNodes, assets, heading ?? undefined);
    });
  }

  const output: ChildNode[] = [];
  let title = "";
  let nodes: ChildNode[] = [];
  let hasExplicitCard = false;
  const flush = () => {
    if (!nodes.length && !title) return;
    output.push(...canonicalCard(title || readableTitleFrom(nodes), nodes, assets));
    nodes = [];
    title = "";
  };

  for (const child of fragment.childNodes) {
    if (isElement(child) && isHeading(child)) {
      flush();
      title = textContent(child);
      hasExplicitCard = true;
      continue;
    }
    nodes.push(child);
  }
  flush();
  if (!hasExplicitCard && output.length) return output;
  return output;
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

    if (element.tagName === "img") {
      const alt = getAttribute(element, "alt") ?? "内容图片";
      setAttributes(element, [
        { name: "src", value: asset.url },
        { name: "data-media-asset-id", value: String(assetId) },
        { name: "alt", value: alt }
      ]);
      return;
    }

    setAttributes(element, [
      { name: "src", value: asset.url },
      { name: "data-media-asset-id", value: String(assetId) },
      { name: "controls", value: "" },
      { name: "preload", value: "metadata" }
    ]);
    element.childNodes = element.childNodes.filter((child) => !isElement(child) || child.tagName !== "source");
  });
}

export function normalizeDetailRichTextToH1Cards(
  rawHtml: string,
  assets: ReadonlyMap<number, DetailPageMediaAsset>
) {
  const sanitized = sanitizeHtml(rawHtml, {
    allowedTags: [...allowedTags],
    allowedAttributes: {
      "*": ["class", "style"],
      a: ["href", "target", "rel", "title", "class", "style"],
      img: ["src", "alt", "width", "height", "data-media-asset-id", "class", "style"],
      video: ["src", "poster", "width", "height", "controls", "preload", "data-media-asset-id", "class", "style"],
      source: ["src", "type"]
    },
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
  const canonicalNodes = normalizeFragmentToCards(fragment, assets);
  const canonicalHtml = serializeNodes(canonicalNodes);
  const canonicalFragment = parseFragment(canonicalHtml);
  if (!hasMeaningfulNode(canonicalFragment, true)) {
    throw new DetailPageValidationError("富文本内容无法解析");
  }
  return canonicalHtml;
}

export function sanitizeAndNormalizeRichText(
  rawHtml: string,
  assets: ReadonlyMap<number, DetailPageMediaAsset>
) {
  assertNoTemporaryMediaSource(rawHtml);
  return normalizeDetailRichTextToH1Cards(rawHtml, assets);
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
