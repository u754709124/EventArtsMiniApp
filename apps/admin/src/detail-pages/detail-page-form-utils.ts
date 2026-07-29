import {
  detailPageInputSchemas,
  detailPageTypeDefinitions,
  type DetailPageConfigField,
  type DetailPageConfigDto,
  type DetailPageInput,
  type DetailPageType
} from "@event-arts/shared";
import type { DetailPageFormValue, DetailTemplateAsset, StandaloneDetailPageFormValue } from "./types";

function cleanOptionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export const detailFormFieldNameByConfigField = {
  heroTitle: "hero",
  heroTypeLabel: "hero",
  heroSubtitle: "heroSubtitle",
  heroBadge: "hero",
  heroTags: "hero",
  heroLocation: "hero",
  heroMetaItems: "hero",
  banners: "bannerAssetIds",
  richText: "richTextHtml"
} as const satisfies Record<DetailPageConfigField, keyof DetailPageFormValue>;

export function detailPageConfigDtoToFormValue(dto: DetailPageConfigDto): DetailPageFormValue {
  if (dto.type === "rich_text") {
    return { type: "rich_text", richTextHtml: dto.richTextHtml };
  }
  const hero = dto.hero ?? {
    title: "",
    typeLabel: "",
    subtitle: dto.heroSubtitle,
    badge: "",
    tags: [],
    location: "",
    metaItems: []
  };
  return {
    type: "banner_rich_text",
    hero: {
      title: hero.title,
      typeLabel: hero.typeLabel,
      subtitle: hero.subtitle,
      badge: hero.badge,
      tags: hero.tags,
      location: hero.location,
      metaItems: hero.metaItems
    },
    heroSubtitle: hero.subtitle || dto.heroSubtitle,
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
  const visibleValue: Record<string, unknown> = type === "banner_rich_text"
    ? {
        type,
        name: "兼容详情页",
        hero: {
          title: formValue.hero?.title ?? "",
          typeLabel: formValue.hero?.typeLabel ?? "",
          subtitle: cleanOptionalText(formValue.hero?.subtitle ?? formValue.heroSubtitle),
          badge: formValue.hero?.badge ?? "",
          tags: formValue.hero?.tags ?? [],
          location: formValue.hero?.location ?? "",
          metaItems: formValue.hero?.metaItems ?? []
        },
        bannerAssetIds: formValue.bannerAssetIds,
        richTextHtml: formValue.richTextHtml
      }
    : { type, name: "兼容详情页", richTextHtml: formValue.richTextHtml };
  return detailPageInputSchemas[type].parse(visibleValue) as DetailPageInput;
}

export function detailPageDtoToStandaloneFormValue(dto: DetailPageConfigDto): StandaloneDetailPageFormValue {
  return {
    name: dto.name,
    detailPage: detailPageConfigDtoToFormValue(dto)
  };
}

export function normalizeStandaloneDetailPageFormValue(values: StandaloneDetailPageFormValue): DetailPageInput {
  if (!values.detailPage || typeof values.detailPage !== "object") throw new Error("请先选择详情页类型");
  const type = values.detailPage.type;
  if (type !== "banner_rich_text" && type !== "rich_text") throw new Error("请先选择详情页类型");
  const name = typeof values.name === "string" ? values.name.trim() : "";
  if (type === "rich_text") {
    return detailPageInputSchemas.rich_text.parse({
      name,
      type,
      richTextHtml: values.detailPage.richTextHtml
    }) as DetailPageInput;
  }
  return detailPageInputSchemas.banner_rich_text.parse({
    name,
    type,
    hero: {
      title: values.detailPage.hero?.title,
      typeLabel: values.detailPage.hero?.typeLabel ?? "",
      subtitle: cleanOptionalText(values.detailPage.hero?.subtitle ?? values.detailPage.heroSubtitle),
      badge: values.detailPage.hero?.badge ?? "",
      tags: values.detailPage.hero?.tags ?? [],
      location: values.detailPage.hero?.location ?? "",
      metaItems: values.detailPage.hero?.metaItems ?? []
    },
    bannerAssetIds: values.detailPage.bannerAssetIds,
    richTextHtml: values.detailPage.richTextHtml
  }) as DetailPageInput;
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
  const fieldPaths = {
    heroTitle: ["detailPage", "hero", "title"],
    heroTypeLabel: ["detailPage", "hero", "typeLabel"],
    heroSubtitle: ["detailPage", "hero", "subtitle"],
    heroBadge: ["detailPage", "hero", "badge"],
    heroTags: ["detailPage", "hero", "tags"],
    heroLocation: ["detailPage", "hero", "location"],
    heroMetaItems: ["detailPage", "hero", "metaItems"],
    banners: ["detailPage", "bannerAssetIds"],
    richText: ["detailPage", "richTextHtml"]
  } as const satisfies Record<DetailPageConfigField, readonly string[]>;
  return [
    ["detailPage", "type"],
    ...detailPageTypeDefinitions[type].configFields.map((field) => [...fieldPaths[field]])
  ];
}
