export type ArtistWaterfallItem = {
  tags?: unknown;
  summary?: unknown;
};

export type ArtistWaterfallColumns<T> = {
  left: T[];
  right: T[];
};

export const artistWaterfallGap = 18;

function hasDisplaySummary(item: ArtistWaterfallItem) {
  return typeof item.summary === "string" && item.summary.trim().length > 0;
}

function hasDisplayTags(item: ArtistWaterfallItem) {
  return Array.isArray(item.tags) && item.tags.some((tag) => typeof tag === "string" && tag.trim().length > 0);
}

export function estimateArtistCardHeight(item: ArtistWaterfallItem) {
  const coverHeight = 240;
  const bodyVerticalPadding = 32;
  const metaHeight = 40;
  const tagBlockHeight = hasDisplayTags(item) ? 44 : 0;
  const summaryBlockHeight = hasDisplaySummary(item) ? 78 : 0;
  return coverHeight + bodyVerticalPadding + metaHeight + tagBlockHeight + summaryBlockHeight;
}

export function buildArtistWaterfallColumns<T extends ArtistWaterfallItem>(items: T[]): ArtistWaterfallColumns<T> {
  const columns: ArtistWaterfallColumns<T> = { left: [], right: [] };
  let leftHeight = 0;
  let rightHeight = 0;

  for (const item of items) {
    const estimatedHeight = estimateArtistCardHeight(item);
    if (leftHeight <= rightHeight) {
      if (columns.left.length > 0) leftHeight += artistWaterfallGap;
      columns.left.push(item);
      leftHeight += estimatedHeight;
    } else {
      if (columns.right.length > 0) rightHeight += artistWaterfallGap;
      columns.right.push(item);
      rightHeight += estimatedHeight;
    }
  }

  return columns;
}
