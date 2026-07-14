import type { DetailPageBannerDto, DetailPageCardDto, DetailPageContentBlockDto, DetailPageConfigDto } from "./detail-pages";

export type DetailPageHeroPresentation = {
  title: string;
  typeLabel: string;
  subtitle: string;
  badge: string;
  tags: string[];
  location: string;
  metaItems: Array<{
    label: string;
    value: string;
  }>;
};

export type DetailPagePresentationModel = {
  hero: DetailPageHeroPresentation;
  banners: DetailPageBannerDto[];
  cards: DetailPageCardDto[];
  /** @deprecated Use cards.flatMap((card) => card.blocks). */
  blocks: DetailPageContentBlockDto[];
  hasSemanticContent: boolean;
};

type StyleDeclaration = readonly [property: string, value: string];

const styleAttributePattern = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu;
const detailHeadingPattern = /(<h1\b[^>]*>)([\s\S]*?)(<\/h1\s*>)/giu;
const detailHeadingMarkerElementPattern =
  /<span\b(?=[^>]*\bdata-detail-heading-marker\s*=\s*(?:"true"|'true'|true))[^>]*>\s*<\/span\s*>/giu;
const detailHeadingContentPattern =
  /<span\b(?=[^>]*\bdata-detail-heading-content\s*=\s*(?:"true"|'true'|true))[^>]*>/iu;

function mergeInlineStyle(
  existing: string,
  required: readonly StyleDeclaration[],
  removedProperties: readonly string[] = []
) {
  const replacedProperties = new Set([
    ...required.map(([property]) => property),
    ...removedProperties
  ]);
  const preserved = existing
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const colonIndex = declaration.indexOf(":");
      if (colonIndex < 1) return true;
      return !replacedProperties.has(declaration.slice(0, colonIndex).trim().toLowerCase());
    });
  return [...preserved, ...required.map(([property, value]) => `${property}:${value}`)].join(";");
}

function mergeTagStyle(
  tag: string,
  required: readonly StyleDeclaration[],
  removedProperties: readonly string[] = []
) {
  const match = styleAttributePattern.exec(tag);
  const existing = match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
  const styleAttribute = ` style="${mergeInlineStyle(existing, required, removedProperties)}"`;
  if (match?.index !== undefined) {
    return `${tag.slice(0, match.index)}${styleAttribute}${tag.slice(match.index + match[0].length)}`;
  }
  const closingIndex = tag.endsWith("/>") ? tag.length - 2 : tag.length - 1;
  return `${tag.slice(0, closingIndex)}${styleAttribute}${tag.slice(closingIndex)}`;
}

const detailHeadingStyles: readonly StyleDeclaration[] = [
  ["display", "flex"],
  ["box-sizing", "border-box"],
  ["align-items", "center"],
  ["padding-left", "0"],
  ["border-left", "0"]
];

const detailHeadingMarkerStyles: readonly StyleDeclaration[] = [
  ["display", "block"],
  ["box-sizing", "border-box"],
  ["flex", "0 0 auto"],
  ["width", "0.233333em"],
  ["height", "1em"],
  ["max-height", "1em"],
  ["margin-right", "0.366667em"],
  ["background", "#e5893d"],
  ["align-self", "center"]
];

const detailHeadingContentStyles: readonly StyleDeclaration[] = [
  ["display", "block"],
  ["box-sizing", "border-box"],
  ["min-width", "0"],
  ["flex", "1"]
];

const detailImageStyles: readonly StyleDeclaration[] = [
  ["display", "block"],
  ["box-sizing", "border-box"],
  ["width", "100%"],
  ["max-width", "100%"],
  ["height", "auto"]
];

/**
 * Applies the shared detail display contract at the trusted rendering boundary.
 * Typography and spacing remain platform-owned at 28rpx in miniapp CSS and
 * 14px in Admin CSS; this helper supplies heading structure, marker and image semantics.
 */
export function enhanceDetailRichTextForPresentation(html: string) {
  const markerHtml = `${mergeTagStyle(
    '<span data-detail-heading-marker="true">',
    detailHeadingMarkerStyles
  )}</span>`;
  const contentOpeningHtml = mergeTagStyle(
    '<span data-detail-heading-content="true">',
    detailHeadingContentStyles
  );
  return html
    .replace(detailHeadingPattern, (_match, openingTag: string, content: string, closingTag: string) => {
      const contentWithoutMarkers = content.replace(detailHeadingMarkerElementPattern, "");
      const contentHtml = detailHeadingContentPattern.test(contentWithoutMarkers)
        ? contentWithoutMarkers.replace(detailHeadingContentPattern, (tag) =>
            mergeTagStyle(tag, detailHeadingContentStyles)
          )
        : `${contentOpeningHtml}${contentWithoutMarkers}</span>`;
      return `${mergeTagStyle(openingTag, detailHeadingStyles)}${markerHtml}${contentHtml}${closingTag}`;
    })
    .replace(/<img\b[^>]*>/giu, (tag) => mergeTagStyle(tag, detailImageStyles));
}

function cleanDetailText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function extractDetailImageUrls(html: string) {
  const urls: string[] = [];
  const sourcePattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
  let match: RegExpExecArray | null;
  while ((match = sourcePattern.exec(html))) {
    const url = cleanDetailText(match[1] || match[2] || match[3]);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function sortDetailPageBanners(banners: readonly DetailPageBannerDto[]) {
  return [...banners].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
}

export function getDisplayDetailPageBanners(banners: readonly DetailPageBannerDto[]) {
  return sortDetailPageBanners(banners)
    .map((banner) => ({ ...banner, url: cleanDetailText(banner.url) }))
    .filter((banner) => Boolean(banner.url));
}

export function collectDetailPageImageUrls(blocks: readonly DetailPageContentBlockDto[]) {
  return blocks.flatMap((block) => (block.type === "richText" ? extractDetailImageUrls(block.html) : []));
}

export function collectDetailPageCardImageUrls(cards: readonly DetailPageCardDto[]) {
  return collectDetailPageImageUrls(cards.flatMap((card) => card.blocks));
}

export function hasSemanticDetailPageContent(blocks: readonly DetailPageContentBlockDto[]) {
  return blocks.some((block) => {
    if (block.type === "video") return Boolean(cleanDetailText(block.url));
    if (extractDetailImageUrls(block.html).length) return true;
    const text = block.html
      .replace(/<[^>]*>/gu, "")
      .replace(/&(?:nbsp|#160|#xA0);/giu, " ")
      .replace(/\s/gu, "");
    return Boolean(text);
  });
}

export function hasSemanticDetailPageCards(cards: readonly DetailPageCardDto[]) {
  return hasSemanticDetailPageContent(cards.flatMap((card) => card.blocks));
}

export function resolveDetailPagePresentation(config: DetailPageConfigDto): DetailPagePresentationModel {
  const hero = config.hero;
  const cards = config.cards?.length ? config.cards : [{ blocks: config.blocks }];
  return {
    hero: {
      title: cleanDetailText(hero.title) || cleanDetailText(config.name),
      typeLabel: cleanDetailText(hero.typeLabel) || cleanDetailText(config.typeLabel),
      subtitle: cleanDetailText(hero.subtitle) || cleanDetailText(config.heroSubtitle),
      badge: cleanDetailText(hero.badge),
      tags: hero.tags.map((tag) => cleanDetailText(tag)).filter(Boolean),
      location: cleanDetailText(hero.location),
      metaItems: hero.metaItems
        .map((item) => ({
          label: cleanDetailText(item.label),
          value: cleanDetailText(item.value)
        }))
        .filter((item) => item.label && item.value)
    },
    banners: getDisplayDetailPageBanners(config.banners),
    cards,
    blocks: cards.flatMap((card) => card.blocks),
    hasSemanticContent: hasSemanticDetailPageCards(cards)
  };
}
