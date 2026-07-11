export type DetailImageHealthChecker = (url: string) => Promise<void>;
export type DetailImagePreviewer = (options: {
  current: string;
  urls: string[];
}) => Promise<unknown> | unknown;

export async function checkDetailImageHealth(
  imageUrls: string[],
  checker: DetailImageHealthChecker
) {
  const uniqueUrls = [...new Set(imageUrls.filter(Boolean))];
  const results = await Promise.all(
    uniqueUrls.map(async (url) => {
      try {
        await checker(url);
        return null;
      } catch {
        return url;
      }
    })
  );
  return results.filter((url): url is string => Boolean(url));
}

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
