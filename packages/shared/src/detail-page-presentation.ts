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

export type DetailRichTextPresentationTarget = "admin" | "weapp";

export type DetailRichTextHeadingFontSize = "30rpx" | "15px";

export type DetailRichTextPresentationOptions =
  | { target: DetailRichTextPresentationTarget }
  /** @deprecated Select an explicit target instead. */
  | { headingFontSize: DetailRichTextHeadingFontSize };

const styleAttributePattern = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu;
const detailHeadingPattern = /(<h1\b[^>]*>)([\s\S]*?)(<\/h1\s*>)/giu;
const defaultContentHeadingPattern = /<h1\b[^>]*>\s*内容\s*<\/h1\s*>/giu;
const detailWeappHeadingPattern =
  /(<div\b(?=[^>]*\bdata-detail-heading\s*=\s*(?:"true"|'true'|true))[^>]*>)([\s\S]*?)(<\/div\s*>)/giu;
const detailHeadingMarkerElementPattern =
  /<span\b(?=[^>]*\bdata-detail-heading-marker\s*=\s*(?:"true"|'true'|true))[^>]*>\s*<\/span\s*>/giu;
const detailHeadingContentPattern =
  /<span\b(?=[^>]*\bdata-detail-heading-content\s*=\s*(?:"true"|'true'|true))[^>]*>/iu;
const detailHeadingDescendantPattern = /<[a-z][\w:-]*\b[^>]*>/giu;
const detailPresentationRootPattern =
  /^<div\b(?=[^>]*\bdata-detail-rich-text-root\s*=\s*(?:"true"|'true'|true))(?=[^>]*\bdata-detail-rich-text-target\s*=\s*(?:"(admin|weapp)"|'(admin|weapp)'|(admin|weapp)))[^>]*>([\s\S]*)<\/div\s*>$/iu;
const currentDetailPresentationVersionPattern =
  /\bdata-detail-rich-text-version\s*=\s*(?:"4"|'4'|4)/iu;

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

function replaceTagName(tag: string, name: "div" | "h1") {
  return tag.replace(/^<(?:h1|div)\b/iu, `<${name}`);
}

function removeAttribute(tag: string, attribute: string) {
  const pattern = new RegExp(`\\s${attribute}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "iu");
  return tag.replace(pattern, "");
}

function setBooleanDataAttribute(tag: string, attribute: string) {
  const withoutExisting = removeAttribute(tag, attribute);
  const closingIndex = withoutExisting.endsWith("/>") ? withoutExisting.length - 2 : withoutExisting.length - 1;
  return `${withoutExisting.slice(0, closingIndex)} ${attribute}="true"${withoutExisting.slice(closingIndex)}`;
}

const detailHeadingStyles: readonly StyleDeclaration[] = [
  ["display", "flex"],
  ["box-sizing", "border-box"],
  ["align-items", "center"],
  ["padding-left", "0"],
  ["border-left", "0"],
  ["font-size", "17px"],
  ["font-weight", "700"],
  ["line-height", "1.35"]
];

const detailHeadingMarkerStyles: readonly StyleDeclaration[] = [
  ["display", "block"],
  ["box-sizing", "border-box"],
  ["flex", "0 0 auto"],
  ["width", "3px"],
  ["height", "13px"],
  ["max-height", "13px"],
  ["margin-right", "5px"],
  ["background", "#e5893d"],
  ["align-self", "center"]
];

const detailHeadingContentStyles: readonly StyleDeclaration[] = [
  ["display", "block"],
  ["box-sizing", "border-box"],
  ["min-width", "0"],
  ["flex", "1"],
  ["font-size", "inherit"],
  ["font-weight", "inherit"],
  ["line-height", "inherit"]
];

const detailRichTextRootStyles: readonly StyleDeclaration[] = [
  ["display", "block"],
  ["box-sizing", "border-box"],
  ["font-size", "15px"],
  ["line-height", "1.72"]
];

function tagAttributeValue(tag: string, attribute: string) {
  const pattern = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu");
  const match = pattern.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function positiveNumericAttribute(tag: string, attribute: string) {
  const value = tagAttributeValue(tag, attribute).trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function formatPx(value: number) {
  return Number.isInteger(value) ? `${value}px` : `${value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "")}px`;
}

function detailImageStylesForTag(tag: string): readonly StyleDeclaration[] {
  const width = positiveNumericAttribute(tag, "width");
  const height = positiveNumericAttribute(tag, "height");
  return [
    ["display", "block"],
    ["box-sizing", "border-box"],
    ["width", width && height ? formatPx(width) : "100%"],
    ["max-width", "100%"],
    ["height", "auto"]
  ];
}

function normalizeHeadingContent(content: string) {
  const contentWithoutMarkers = content.replace(detailHeadingMarkerElementPattern, "");
  const clampedContent = contentWithoutMarkers.replace(detailHeadingDescendantPattern, (tag) =>
    mergeTagStyle(tag, [
      ["font-size", "inherit"],
      ["font-weight", "inherit"],
      ["line-height", "inherit"]
    ], ["font"])
  );
  if (detailHeadingContentPattern.test(clampedContent)) {
    return clampedContent.replace(detailHeadingContentPattern, (tag) =>
      mergeTagStyle(tag, detailHeadingContentStyles, ["font"])
    );
  }
  return `${mergeTagStyle(
    '<span data-detail-heading-content="true">',
    detailHeadingContentStyles,
    ["font"]
  )}${clampedContent}</span>`;
}

function renderHeading(openingTag: string, content: string, target: DetailRichTextPresentationTarget) {
  let normalizedOpeningTag = replaceTagName(openingTag, target === "weapp" ? "div" : "h1");
  normalizedOpeningTag = target === "weapp"
    ? setBooleanDataAttribute(normalizedOpeningTag, "data-detail-heading")
    : removeAttribute(normalizedOpeningTag, "data-detail-heading");
  normalizedOpeningTag = mergeTagStyle(normalizedOpeningTag, detailHeadingStyles, ["font"]);
  const marker = `${mergeTagStyle(
    '<span data-detail-heading-marker="true">',
    detailHeadingMarkerStyles
  )}</span>`;
  return `${normalizedOpeningTag}${marker}${normalizeHeadingContent(content)}</${target === "weapp" ? "div" : "h1"}>`;
}

function unwrapPresentationRoot(html: string) {
  const match = detailPresentationRootPattern.exec(html);
  if (!match) return { html, target: undefined };
  return {
    html: match[4],
    target: (match[1] ?? match[2] ?? match[3]) as DetailRichTextPresentationTarget
  };
}

/**
 * Produces platform-owned display HTML without changing canonical stored HTML.
 * WeChat receives div-based headings to avoid native h1 sizing; Admin retains
 * h1 semantics. Both targets receive explicit px typography at the HTML boundary.
 */
export function enhanceDetailRichTextForPresentation(
  html: string,
  options: DetailRichTextPresentationOptions = { target: "weapp" }
) {
  const target = "target" in options
    ? options.target
    : options.headingFontSize === "15px" ? "admin" : "weapp";
  const existingRoot = unwrapPresentationRoot(html);
  if (existingRoot.target === target && currentDetailPresentationVersionPattern.test(html)) return html;

  const headingNormalized = existingRoot.html
    .replace(defaultContentHeadingPattern, "")
    .replace(detailHeadingPattern, (_match, openingTag: string, content: string) =>
      renderHeading(openingTag, content, target)
    )
    .replace(detailWeappHeadingPattern, (_match, openingTag: string, content: string) =>
      renderHeading(openingTag, content, target)
    );
  const imageNormalized = headingNormalized.replace(/<img\b[^>]*>/giu, (tag) =>
    mergeTagStyle(tag, detailImageStylesForTag(tag))
  );
  const rootOpeningTag = mergeTagStyle(
    `<div data-detail-rich-text-root="true" data-detail-rich-text-target="${target}" data-detail-rich-text-version="4">`,
    detailRichTextRootStyles,
    ["font"]
  );
  return `${rootOpeningTag}${imageNormalized}</div>`;
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
