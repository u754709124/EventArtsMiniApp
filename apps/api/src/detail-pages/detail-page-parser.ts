import { parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import type { DetailPageCardDto, DetailPageContentBlockDto } from "@event-arts/shared";
import { DetailPageValidationError, type DetailPageMediaAsset } from "./detail-page-types";
import { attachParentNodes, hasRenderableRichTextHtml } from "./detail-page-sanitizer";

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

type Segment =
  | { type: "node"; node: ChildNode }
  | { type: "video"; element: Element };

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function isTextNode(node: ChildNode): node is DefaultTreeAdapterTypes.TextNode {
  return !isElement(node) && node.nodeName === "#text";
}

function isCommentNode(node: ChildNode): node is DefaultTreeAdapterTypes.CommentNode {
  return !isElement(node) && node.nodeName === "#comment";
}

function isDocumentType(node: ChildNode): node is DefaultTreeAdapterTypes.DocumentType {
  return !isElement(node) && node.nodeName === "#documentType";
}

function cloneLeaf(node: ChildNode): ChildNode {
  if (isTextNode(node)) return { nodeName: "#text", value: node.value, parentNode: null };
  if (isCommentNode(node)) return { nodeName: "#comment", data: node.data, parentNode: null };
  if (isDocumentType(node)) {
    return {
      nodeName: "#documentType",
      name: node.name,
      publicId: node.publicId,
      systemId: node.systemId,
      parentNode: null
    };
  }
  throw new DetailPageValidationError("富文本节点解析失败");
}

function cloneElement(element: Element, childNodes: ChildNode[]): Element {
  return {
    nodeName: element.nodeName,
    tagName: element.tagName,
    attrs: element.attrs.map((attribute) => ({ ...attribute })),
    namespaceURI: element.namespaceURI,
    parentNode: null,
    childNodes
  };
}

function splitNode(node: ChildNode): Segment[] {
  if (!isElement(node)) return [{ type: "node", node: cloneLeaf(node) }];
  if (node.tagName === "video") return [{ type: "video", element: node }];

  const output: Segment[] = [];
  let currentChildren: ChildNode[] = [];
  const flush = () => {
    if (!currentChildren.length && node.childNodes.length) return;
    output.push({ type: "node", node: cloneElement(node, currentChildren) });
    currentChildren = [];
  };

  for (const child of node.childNodes) {
    for (const segment of splitNode(child)) {
      if (segment.type === "node") {
        currentChildren.push(segment.node);
      } else {
        if (currentChildren.length) flush();
        output.push(segment);
      }
    }
  }
  if (currentChildren.length || node.childNodes.length === 0) flush();
  return output;
}

function serializeNodes(nodes: ChildNode[]) {
  const fragment: DefaultTreeAdapterTypes.DocumentFragment = {
    nodeName: "#document-fragment",
    childNodes: nodes
  };
  attachParentNodes(fragment);
  return serialize(fragment).trim();
}

function getMediaAssetId(element: Element) {
  const value = element.attrs.find((attribute) => attribute.name === "data-media-asset-id")?.value ?? "";
  const assetId = Number(value);
  if (!Number.isInteger(assetId) || assetId <= 0) throw new DetailPageValidationError("视频节点缺少合法媒体资源 ID");
  return assetId;
}

export function buildDetailPageBlocks(
  html: string,
  assets: ReadonlyMap<number, DetailPageMediaAsset>
): DetailPageContentBlockDto[] {
  return buildDetailPageCards(html, assets).flatMap((card) => card.blocks);
}

function buildBlocksFromNodes(nodes: ChildNode[], assets: ReadonlyMap<number, DetailPageMediaAsset>) {
  const segments = nodes.flatMap(splitNode);
  const blocks: DetailPageContentBlockDto[] = [];
  let richNodes: ChildNode[] = [];

  const flushRichText = () => {
    if (!richNodes.length) return;
    const richText = serializeNodes(richNodes);
    richNodes = [];
    if (hasRenderableRichTextHtml(richText)) blocks.push({ type: "richText", html: richText });
  };

  for (const segment of segments) {
    if (segment.type === "node") {
      richNodes.push(segment.node);
      continue;
    }
    flushRichText();
    const assetId = getMediaAssetId(segment.element);
    const asset = assets.get(assetId);
    if (!asset) throw new DetailPageValidationError(`媒体资源 ${assetId} 不存在`);
    if (asset.mediaType !== "video") throw new DetailPageValidationError("视频节点只能引用视频资源");
    blocks.push({
      type: "video",
      assetId,
      url: asset.url,
      posterUrl: null,
      width: asset.width,
      height: asset.height
    });
  }
  flushRichText();
  return blocks;
}

export function buildDetailPageCards(
  html: string,
  assets: ReadonlyMap<number, DetailPageMediaAsset>
): DetailPageCardDto[] {
  const fragment = parseFragment(html);
  const cardNodes: ChildNode[][] = [];
  let current: ChildNode[] = [];
  const flush = () => {
    if (!current.length) return;
    cardNodes.push(current);
    current = [];
  };

  for (const child of fragment.childNodes) {
    if (isElement(child) && child.tagName === "h1") flush();
    current.push(child);
  }
  flush();

  const cards = cardNodes
    .map((nodes) => ({ blocks: buildBlocksFromNodes(nodes, assets) }))
    .filter((card) => card.blocks.length > 0);

  if (!cards.length) throw new DetailPageValidationError("富文本内容无法解析");
  return cards;
}
