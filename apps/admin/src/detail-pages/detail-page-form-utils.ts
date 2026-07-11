import {
  detailPageInputSchemas,
  detailPageTypeDefinitions,
  type DetailPageConfigField,
  type DetailPageConfigDto,
  type DetailPageInput,
  type DetailPageType
} from "@event-arts/shared";
import type { DetailPageFormValue, DetailTemplateAsset } from "./types";

export const detailFormFieldNameByConfigField = {
  heroSubtitle: "heroSubtitle",
  banners: "bannerAssetIds",
  richText: "richTextHtml"
} as const satisfies Record<DetailPageConfigField, keyof DetailPageFormValue>;

export function detailPageConfigDtoToFormValue(dto: DetailPageConfigDto): DetailPageFormValue {
  if (dto.type === "rich_text") {
    return { type: "rich_text", richTextHtml: dto.richTextHtml };
  }
  return {
    type: "banner_rich_text",
    heroSubtitle: dto.heroSubtitle,
    bannerAssetIds: [...dto.banners]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((banner) => banner.assetId),
    richTextHtml: dto.richTextHtml
  };
}

export function normalizeDetailPageFormValue(value: unknown): DetailPageInput {
  if (!value || typeof value !== "object") throw new Error("请先选择详情页类型");
  const type = (value as DetailPageFormValue).type;
  if (type !== "banner_rich_text" && type !== "rich_text") {
    throw new Error("请先选择详情页类型");
  }
  const formValue = value as DetailPageFormValue;
  const visibleValue: Record<string, unknown> = { type };
  for (const configField of detailPageTypeDefinitions[type].configFields) {
    const formField = detailFormFieldNameByConfigField[configField];
    visibleValue[formField] = formValue[formField];
  }
  return detailPageInputSchemas[type].parse(visibleValue) as DetailPageInput;
}

export function isMeaningfulRichText(value: unknown) {
  if (typeof value !== "string") return false;
  if (/<(?:img|video)\b[^>]*data-media-asset-id=/i.test(value)) return true;
  return value
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|\s/gi, "")
    .length > 0;
}

export function extractRichTextMediaAssetIds(html: unknown) {
  if (typeof html !== "string" || !html) return [];
  const document = new DOMParser().parseFromString(html, "text/html");
  return [...document.querySelectorAll("img[data-media-asset-id], video[data-media-asset-id]")]
    .map((node) => Number(node.getAttribute("data-media-asset-id")))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

export function uniquePositiveAssetIds(values: readonly unknown[]) {
  return [...new Set(values.filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0))];
}

export function hydrateTemplateMediaSources(html: string, assets: readonly DetailTemplateAsset[]) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const node of document.querySelectorAll("img[data-media-asset-id], video[data-media-asset-id]")) {
    const id = Number(node.getAttribute("data-media-asset-id"));
    const asset = byId.get(id);
    if (!asset) continue;
    const expectedType = node.tagName === "IMG" ? "image" : "video";
    if (asset.mediaType !== expectedType) continue;
    node.setAttribute("src", asset.url);
    if (node.tagName === "VIDEO") {
      node.setAttribute("controls", "");
      node.setAttribute("preload", "metadata");
      node.removeAttribute("autoplay");
      node.removeAttribute("loop");
    }
  }
  return document.body.innerHTML;
}

export function detailFieldPaths(type: DetailPageType) {
  return [
    ["detailPage", "type"],
    ...detailPageTypeDefinitions[type].configFields.map((configField) => [
      "detailPage",
      detailFormFieldNameByConfigField[configField]
    ])
  ];
}
