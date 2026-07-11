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
