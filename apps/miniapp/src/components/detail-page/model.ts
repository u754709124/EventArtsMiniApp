import type {
  DetailPageBannerDto,
  DetailPageBlockDto,
  DetailPageRendererKey
} from "@event-arts/shared";
import type { DetailLayoutContract } from "./types";

const layoutContracts = {
  bannerRichText: {
    createsBanner: true,
    createsHero: true,
    createsCounter: true,
    createsBannerSkeleton: true,
    reservesBannerHeight: true,
    usesNegativeOverlap: true
  },
  richText: {
    createsBanner: false,
    createsHero: false,
    createsCounter: false,
    createsBannerSkeleton: false,
    reservesBannerHeight: false,
    usesNegativeOverlap: false
  }
} as const satisfies Record<DetailPageRendererKey, DetailLayoutContract>;

export function getRendererRegistration(): DetailPageRendererKey[] {
  return Object.keys(layoutContracts) as DetailPageRendererKey[];
}

export function getDetailLayoutContract(rendererKey: DetailPageRendererKey): DetailLayoutContract {
  const contract = layoutContracts[rendererKey];
  if (!contract) throw new Error(`未知详情页渲染器：${String(rendererKey)}`);
  return contract;
}

export function sortDetailBanners(banners: DetailPageBannerDto[]) {
  return [...banners].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
}

function extractImageUrls(html: string) {
  const urls: string[] = [];
  const sourcePattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
  let match: RegExpExecArray | null;
  while ((match = sourcePattern.exec(html))) {
    const url = (match[1] || match[2] || match[3] || "").trim();
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function collectDetailImageUrls(blocks: DetailPageBlockDto[]) {
  return blocks.flatMap((block) => (block.type === "richText" ? extractImageUrls(block.html) : []));
}

export function hasSemanticDetailContent(blocks: DetailPageBlockDto[]) {
  return blocks.some((block) => {
    if (block.type === "video") return Boolean(block.url.trim());
    if (extractImageUrls(block.html).length) return true;
    const text = block.html
      .replace(/<[^>]*>/gu, "")
      .replace(/&(?:nbsp|#160|#xA0);/giu, " ")
      .replace(/\s/gu, "");
    return Boolean(text);
  });
}
