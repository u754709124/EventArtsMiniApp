import { createHash } from "node:crypto";
import { resolveMediaAssetUrl, type MediaUrlAsset } from "../media-url";

export const EDGEONE_PREFETCH_MODE = "default" as const;

export type PrefetchIdentityAsset = MediaUrlAsset & {
  id: number;
  md5: string;
};

export type CanonicalPrefetchTarget =
  | {
      eligible: true;
      targetUrl: string;
      targetHash: string;
    }
  | {
      eligible: false;
      reason:
        | "INVALID_PUBLIC_BASE_URL"
        | "INVALID_ASSET_URL"
        | "HTTPS_REQUIRED"
        | "HOSTNAME_MISMATCH"
        | "USERINFO_NOT_ALLOWED"
        | "QUERY_NOT_ALLOWED"
        | "FRAGMENT_NOT_ALLOWED";
    };

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalPrefetchTarget(
  asset: PrefetchIdentityAsset,
  publicBaseUrl: string
): CanonicalPrefetchTarget {
  let base: URL;
  try {
    base = new URL(publicBaseUrl);
  } catch {
    return { eligible: false, reason: "INVALID_PUBLIC_BASE_URL" };
  }

  let target: URL;
  try {
    target = new URL(resolveMediaAssetUrl(publicBaseUrl, asset));
  } catch {
    return { eligible: false, reason: "INVALID_ASSET_URL" };
  }

  if (target.protocol !== "https:") {
    return { eligible: false, reason: "HTTPS_REQUIRED" };
  }
  if (target.hostname !== base.hostname) {
    return { eligible: false, reason: "HOSTNAME_MISMATCH" };
  }
  if (target.username || target.password) {
    return { eligible: false, reason: "USERINFO_NOT_ALLOWED" };
  }
  if (target.search) {
    return { eligible: false, reason: "QUERY_NOT_ALLOWED" };
  }
  if (target.hash) {
    return { eligible: false, reason: "FRAGMENT_NOT_ALLOWED" };
  }

  const targetUrl = target.toString();
  return { eligible: true, targetUrl, targetHash: sha256(targetUrl) };
}

export type PrefetchIdentity = {
  zoneId: string;
  mediaAssetId: number;
  contentVersion: string;
  targetHash: string;
  mode: typeof EDGEONE_PREFETCH_MODE;
};

export function createPrefetchIdentity(
  zoneId: string,
  asset: PrefetchIdentityAsset,
  target: Extract<CanonicalPrefetchTarget, { eligible: true }>
): PrefetchIdentity & { idempotencyKey: string } {
  const identity: PrefetchIdentity = {
    zoneId,
    mediaAssetId: asset.id,
    contentVersion: asset.md5,
    targetHash: target.targetHash,
    mode: EDGEONE_PREFETCH_MODE
  };

  return {
    ...identity,
    idempotencyKey: sha256(JSON.stringify(identity))
  };
}
