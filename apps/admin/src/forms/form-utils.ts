export type AnyRecord = Record<string, unknown>;

export function normalizeTags(value: unknown, limit?: number) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? parseMaybeJsonArray(value)
      : [];
  const seen = new Set<string>();
  const tags = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase("zh-CN");
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return typeof limit === "number" ? tags.slice(0, limit) : tags;
}

function parseMaybeJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeArtistFormTags(value: unknown) {
  return normalizeTags(value, 4);
}

export function millisecondsToSeconds(value: unknown, fallback = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric / 100) / 10;
}

export function secondsToMilliseconds(value: unknown, fallback = 3000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric * 1000);
}

export function omitBusinessDetailFields(values: AnyRecord) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !["detail", "detailMediaAssetIds", "detailPage"].includes(key))
  );
}

export function statusLabel(value: unknown) {
  return value === "enabled" ? "启用" : "停用";
}

export function statusColor(value: unknown) {
  return value === "enabled" ? "green" : "default";
}

export function firstValidationField(error: unknown) {
  if (!error || typeof error !== "object" || !("errorFields" in error)) return undefined;
  const fields = (error as { errorFields?: Array<{ name?: Array<string | number> }> }).errorFields;
  return fields?.[0]?.name;
}
