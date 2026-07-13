export type MediaUrlAsset = {
  filename: string;
  url: string;
  storageType?: string | null;
};

function normalizeStorageFilename(filename: string) {
  const normalized = filename.trim().replace(/^\/+/, "").replace(/^uploads\//, "");
  if (!normalized || normalized.includes("\\") || normalized.includes("\0")) {
    throw new Error("invalid media storage filename");
  }
  if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("invalid media storage filename");
  }
  return normalized;
}

export function localMediaStoredUrl(filename: string) {
  return `/uploads/${normalizeStorageFilename(filename)}`;
}

export function publicLocalMediaUrl(publicBaseUrl: string, filename: string) {
  const base = new URL(publicBaseUrl);
  return new URL(localMediaStoredUrl(filename), base.origin).toString();
}

export function resolveMediaAssetUrl(publicBaseUrl: string, asset: MediaUrlAsset) {
  if (!asset.storageType || asset.storageType === "local") {
    return publicLocalMediaUrl(publicBaseUrl, asset.filename);
  }
  return asset.url;
}

export function resolveStoredMediaAssetUrl(asset: MediaUrlAsset) {
  if (!asset.storageType || asset.storageType === "local") {
    return localMediaStoredUrl(asset.filename);
  }
  return asset.url;
}

export function withResolvedMediaAssetUrl<T extends MediaUrlAsset>(publicBaseUrl: string, asset: T): T {
  return {
    ...asset,
    url: resolveMediaAssetUrl(publicBaseUrl, asset)
  };
}
