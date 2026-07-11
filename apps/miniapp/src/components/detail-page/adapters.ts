import type { ActivityCaseDetailDto, ArtistDetailDto, ArtistType } from "@event-arts/shared";
import type { DetailHeroViewModel } from "./types";

const artistTypeLabels = {
  host: "主持人",
  singer: "歌手",
  actor: "演员"
} as const satisfies Record<ArtistType, string>;

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function buildArtistHero(item: ArtistDetailDto): DetailHeroViewModel {
  return {
    title: item.name,
    typeLabel: artistTypeLabels[item.type],
    subtitle: clean(item.detailPage.heroSubtitle),
    badge: clean(item.badge),
    tags: item.tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 4),
    location: clean(item.location)
  };
}

export function buildCaseHero(item: ActivityCaseDetailDto): DetailHeroViewModel {
  const eventDate = clean(item.eventDate);
  return {
    title: item.title,
    typeLabel: clean(item.category) || clean(item.tag),
    subtitle: clean(item.detailPage.heroSubtitle),
    badge: clean(item.tag),
    location: clean(item.location),
    metaItems: eventDate ? [{ label: "日期", value: eventDate }] : undefined
  };
}
