export type DetailImagePreviewer = (options: {
  current: string;
  urls: string[];
}) => Promise<unknown> | unknown;

export function updateFailedMediaIds(ids: number[], mediaId: number, failed: boolean) {
  if (failed) return ids.includes(mediaId) ? ids : [...ids, mediaId];
  return ids.filter((id) => id !== mediaId);
}

type RichTextClickEvent = {
  target?: { src?: string; dataset?: { src?: string } };
  detail?: { src?: string };
};

export function resolveRichTextImageTarget(event: unknown, imageUrls: string[]) {
  const candidate = event as RichTextClickEvent | undefined;
  const current =
    candidate?.target?.dataset?.src || candidate?.target?.src || candidate?.detail?.src;
  return current && imageUrls.includes(current) ? current : undefined;
}

export async function previewRichTextImage(
  event: unknown,
  imageUrls: string[],
  previewer: DetailImagePreviewer
) {
  const current = resolveRichTextImageTarget(event, imageUrls);
  if (!current) return false;
  await previewer({ current, urls: imageUrls });
  return true;
}
