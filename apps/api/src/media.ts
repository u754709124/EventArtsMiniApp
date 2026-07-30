import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { link, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  mediaFieldRules,
  normalizeMediaTags,
  normalizeResourceName,
  type MediaAssetDto,
  type MediaFieldKey,
  type MediaReferenceSourceDto,
  type MediaType,
  type MediaUploadConfigDto
} from "@event-arts/shared";
import type { MultipartFile } from "@fastify/multipart";
import ffprobe from "@ffprobe-installer/ffprobe";
import type { Prisma } from "@prisma/client";
import sharp from "sharp";
import type { AppPrismaClient } from "./db";
import { localMediaStoredUrl, resolveMediaAssetUrl } from "./media-url";

export const imageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const videoMimeTypes = ["video/mp4"] as const;
const execFileAsync = promisify(execFile);

export type UploadLimits = {
  imageMaxBytes: number;
  videoMaxBytes: number;
};

function uploadLimit(name: "MAX_IMAGE_UPLOAD_BYTES" | "MAX_VIDEO_UPLOAD_BYTES", fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

export function getUploadLimits(): UploadLimits {
  return {
    imageMaxBytes: uploadLimit("MAX_IMAGE_UPLOAD_BYTES", 10 * 1024 * 1024),
    videoMaxBytes: uploadLimit("MAX_VIDEO_UPLOAD_BYTES", 100 * 1024 * 1024)
  };
}

export function getUploadConfig(): MediaUploadConfigDto {
  const limits = getUploadLimits();
  return {
    image: { mimeTypes: [...imageMimeTypes], maxBytes: limits.imageMaxBytes },
    video: { mimeTypes: [...videoMimeTypes], maxBytes: limits.videoMaxBytes },
    fieldRules: mediaFieldRules
  };
}

export function mediaTypeForMime(mimeType: string): MediaType | null {
  if ((imageMimeTypes as readonly string[]).includes(mimeType)) return "image";
  if ((videoMimeTypes as readonly string[]).includes(mimeType)) return "video";
  return null;
}

export function canonicalExtension(mimeType: string) {
  return ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4"
  } as Record<string, string>)[mimeType];
}

export async function mediaReferenceCount(prisma: AppPrismaClient, id: number) {
  return (await mediaReferenceSources(prisma, id)).reduce((total, source) => total + source.count, 0);
}

function formatArticleCoverReferenceLabel(items: Array<{ id: number; title: string }>) {
  if (!items.length) return "文章封面";
  const visible = items.slice(0, 3).map((item) => `${item.title}（ID ${item.id}）`);
  const suffix = items.length > visible.length ? ` 等 ${items.length} 篇` : "";
  return `文章封面：${visible.join("、")}${suffix}`;
}

function formatRecentActivityCoverReferenceLabel(items: Array<{ id: number; title: string }>) {
  if (!items.length) return "近日活动封面";
  const visible = items.slice(0, 3).map((item) => `${item.title}（ID ${item.id}）`);
  const suffix = items.length > visible.length ? ` 等 ${items.length} 条` : "";
  return `近日活动封面：${visible.join("、")}${suffix}`;
}

export async function mediaReferenceSources(prisma: AppPrismaClient, id: number): Promise<MediaReferenceSourceDto[]> {
  const legacyCaseDetailCount = prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `SELECT COUNT(*) AS count
     FROM activity_case_media cm
     WHERE cm.mediaAssetId = ?
       AND NOT EXISTS (
         SELECT 1 FROM activity_cases ac
         WHERE ac.id = cm.activityCaseId AND ac.detailPageId IS NOT NULL
       )`,
    id
  ).then((rows) => Number(rows[0]?.count ?? 0));
  const articleCoverReferences = prisma.article.findMany({
    where: { coverAssetId: id },
    select: { id: true, title: true },
    orderBy: { id: "asc" }
  });
  const recentActivityCoverReferences = prisma.recentActivity.findMany({
    where: { coverAssetId: id },
    select: { id: true, title: true },
    orderBy: { id: "asc" }
  });
  const [
    siteDefaultBannerCount,
    sitePlaceholderBannerCount,
    sitePlaceholderIconCount,
    sitePlaceholderCaseCount,
    bannerCount,
    menuCount,
    caseCoverCount,
    articleCoverItems,
    recentActivityCoverItems,
    artistCoverCount,
    legacyCaseDetailReferenceCount,
    detailPageBannerCount,
    detailPageContentCount
  ] = await Promise.all([
    prisma.siteConfig.count({ where: { defaultBannerAssetId: id } }),
    prisma.siteConfig.count({ where: { placeholderBannerAssetId: id } }),
    prisma.siteConfig.count({ where: { placeholderIconAssetId: id } }),
    prisma.siteConfig.count({ where: { placeholderCaseAssetId: id } }),
    prisma.banner.count({ where: { imageAssetId: id } }),
    prisma.menuItem.count({ where: { iconAssetId: id } }),
    prisma.activityCase.count({ where: { coverAssetId: id } }),
    articleCoverReferences,
    recentActivityCoverReferences,
    prisma.artist.count({ where: { avatarAssetId: id } }),
    legacyCaseDetailCount,
    prisma.detailPageBannerMedia.count({ where: { mediaAssetId: id } }),
    prisma.detailPageContentMedia.count({ where: { mediaAssetId: id } })
  ]);
  const counts = [
    siteDefaultBannerCount,
    sitePlaceholderBannerCount,
    sitePlaceholderIconCount,
    sitePlaceholderCaseCount,
    bannerCount,
    menuCount,
    caseCoverCount,
    articleCoverItems.length,
    recentActivityCoverItems.length,
    artistCoverCount,
    legacyCaseDetailReferenceCount,
    detailPageBannerCount,
    detailPageContentCount
  ];
  const definitions: Array<Omit<MediaReferenceSourceDto, "count">> = [
    { type: "site_default_banner", label: "首页默认 BANNER" },
    { type: "site_placeholder_banner", label: "BANNER 占位图" },
    { type: "site_placeholder_icon", label: "菜单占位图" },
    { type: "site_placeholder_case", label: "案例占位图" },
    { type: "banner", label: "首页 BANNER" },
    { type: "menu", label: "菜单图标" },
    { type: "case_cover", label: "案例封面" },
    { type: "article_cover", label: formatArticleCoverReferenceLabel(articleCoverItems) },
    { type: "recent_activity_cover", label: formatRecentActivityCoverReferenceLabel(recentActivityCoverItems) },
    { type: "artist_cover", label: "人员列表封面" },
    { type: "legacy_case_detail", label: "旧案例详情媒体" },
    { type: "detail_page_banner", label: "详情页 BANNER" },
    { type: "detail_page_content", label: "详情页富文本" }
  ];
  return definitions.flatMap((definition, index) => counts[index] ? [{ ...definition, count: counts[index] }] : []);
}

type AssetWithTags = Prisma.MediaAssetGetPayload<{ include: { tags: true } }>;

export async function toMediaAssetDto(
  prisma: AppPrismaClient,
  asset: AssetWithTags,
  known: { publicBaseUrl: string; referenceCount?: number; createdByName?: string | null }
): Promise<MediaAssetDto> {
  const [referenceSources, creator] = await Promise.all([
    mediaReferenceSources(prisma, asset.id),
    Object.hasOwn(known, "createdByName")
      ? known.createdByName ? { username: known.createdByName } : null
      : asset.createdBy ? prisma.adminUser.findUnique({ where: { id: asset.createdBy }, select: { username: true } }) : null
  ]);
  const referenceCount = known.referenceCount ?? referenceSources.reduce((total, source) => total + source.count, 0);
  return {
    id: asset.id,
    resourceName: asset.resourceName,
    originalName: asset.originalName,
    md5: asset.md5,
    mimeType: asset.mimeType,
    mediaType: asset.mediaType as MediaType,
    url: resolveMediaAssetUrl(known.publicBaseUrl, asset),
    width: asset.width,
    height: asset.height,
    size: asset.size,
    storageType: "local",
    tags: asset.tags.map((tag) => tag.label),
    referenceCount,
    referenceSources,
    inUse: referenceCount > 0,
    createdBy: asset.createdBy,
    createdByName: creator?.username ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString()
  };
}

const mediaReferenceSql = `
  (SELECT COUNT(*) FROM site_config s WHERE s.defaultBannerAssetId = m.id) +
  (SELECT COUNT(*) FROM site_config s WHERE s.placeholderBannerAssetId = m.id) +
  (SELECT COUNT(*) FROM site_config s WHERE s.placeholderIconAssetId = m.id) +
  (SELECT COUNT(*) FROM site_config s WHERE s.placeholderCaseAssetId = m.id) +
  (SELECT COUNT(*) FROM banners b WHERE b.imageAssetId = m.id) +
  (SELECT COUNT(*) FROM menu_items mi WHERE mi.iconAssetId = m.id) +
  (SELECT COUNT(*) FROM activity_cases ac WHERE ac.coverAssetId = m.id) +
  (SELECT COUNT(*) FROM articles ar WHERE ar.coverAssetId = m.id) +
  (SELECT COUNT(*) FROM recent_activities ra WHERE ra.coverAssetId = m.id) +
  (SELECT COUNT(*) FROM artists a WHERE a.avatarAssetId = m.id) +
  (SELECT COUNT(*) FROM activity_case_media cm
   WHERE cm.mediaAssetId = m.id
     AND NOT EXISTS (
       SELECT 1 FROM activity_cases ac
       WHERE ac.id = cm.activityCaseId AND ac.detailPageId IS NOT NULL
     )) +
  (SELECT COUNT(*) FROM detail_page_banner_media dbm WHERE dbm.mediaAssetId = m.id) +
  (SELECT COUNT(*) FROM detail_page_content_media dcm WHERE dcm.mediaAssetId = m.id)
`;

export type MediaReferenceQuery = {
  mediaType?: MediaType;
  q?: string;
  tagKey?: string;
  referenceStatus?: "used" | "unused";
  offset?: number;
  limit?: number;
};

export async function queryMediaReferences(prisma: AppPrismaClient, query: MediaReferenceQuery) {
  const where: string[] = [];
  const values: Array<string | number> = [];
  if (query.mediaType) {
    where.push("m.mediaType = ?");
    values.push(query.mediaType);
  }
  if (query.q) {
    where.push("(m.resourceName LIKE ? OR m.originalName LIKE ?)");
    values.push(`%${query.q}%`, `%${query.q}%`);
  }
  if (query.tagKey) {
    where.push("EXISTS (SELECT 1 FROM media_asset_tags t WHERE t.mediaAssetId = m.id AND t.labelKey = ?)");
    values.push(query.tagKey);
  }
  if (query.referenceStatus) {
    where.push(`(${mediaReferenceSql}) ${query.referenceStatus === "used" ? ">" : "="} 0`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRows = await prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
    `SELECT COUNT(*) AS total FROM media_assets m ${whereSql}`,
    ...values
  );
  const pagination = query.limit === undefined ? "" : "LIMIT ? OFFSET ?";
  const pageValues = query.limit === undefined ? values : [...values, query.limit, query.offset ?? 0];
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; referenceCount: number | bigint }>>(
    `SELECT m.id, (${mediaReferenceSql}) AS referenceCount
     FROM media_assets m ${whereSql}
     ORDER BY m.createdAt DESC, m.id DESC ${pagination}`,
    ...pageValues
  );
  return {
    rows: rows.map((row) => ({ id: Number(row.id), referenceCount: Number(row.referenceCount) })),
    total: Number(countRows[0]?.total ?? 0)
  };
}

export function validateAssetForField(
  fieldKey: MediaFieldKey,
  asset: { mediaType: string; width: number | null; height: number | null }
) {
  const rule = mediaFieldRules[fieldKey];
  if (!rule.allowedTypes.includes(asset.mediaType as MediaType)) {
    return { code: "INVALID_MEDIA_TYPE", message: `${rule.label}不支持该资源类型` };
  }
  if (!asset.width || !asset.height) {
    return { code: "INVALID_MEDIA_METADATA", message: `${rule.label}无法读取资源尺寸` };
  }
  return null;
}

export type PersistedUpload = {
  tempPath: string;
  originalName: string;
  mimeType: string;
  size: number;
  md5: string;
};

export async function persistMultipartFile(part: MultipartFile, uploadDir: string): Promise<PersistedUpload> {
  const tempDir = path.join(uploadDir, ".tmp");
  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${randomBytes(16).toString("hex")}.upload`);
  const hash = createHash("md5");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(part.file, meter, createWriteStream(tempPath, { flags: "wx" }));
    if (part.file.truncated) throw new Error("FILE_TOO_LARGE");
    return {
      tempPath,
      originalName: part.filename,
      mimeType: part.mimetype,
      size,
      md5: hash.digest("hex")
    };
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

export async function inspectUpload(upload: PersistedUpload) {
  const mediaType = mediaTypeForMime(upload.mimeType);
  if (!mediaType) return { ok: false, error: { code: "INVALID_MEDIA_TYPE", message: "仅支持 JPG、PNG、WebP 图片和 MP4 视频" } } as const;
  const limits = getUploadLimits();
  const maxBytes = mediaType === "image" ? limits.imageMaxBytes : limits.videoMaxBytes;
  if (upload.size > maxBytes) return { ok: false, error: { code: "FILE_TOO_LARGE", message: `文件大小不能超过 ${Math.floor(maxBytes / 1024 / 1024)}MB` } } as const;
  if (mediaType === "video") {
    try {
      const { stdout } = await execFileAsync(ffprobe.path, [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=format_name",
        "-of",
        "json",
        upload.tempPath
      ]);
      const info = JSON.parse(stdout) as {
        streams?: Array<{ width?: number; height?: number }>;
        format?: { format_name?: string };
      };
      const stream = info.streams?.[0];
      if (!stream?.width || !stream.height || !info.format?.format_name?.split(",").includes("mp4")) {
        throw new Error("invalid MP4 metadata");
      }
      return { ok: true, mediaType, mimeType: "video/mp4" as const, width: stream.width, height: stream.height } as const;
    } catch {
      return { ok: false, error: { code: "INVALID_MEDIA_METADATA", message: "无法解析视频资源" } } as const;
    }
  }
  try {
    const metadata = await sharp(upload.tempPath).metadata();
    const mimeType = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>)[metadata.format ?? ""];
    if (!metadata.width || !metadata.height || !mimeType) throw new Error("invalid image metadata");
    return { ok: true, mediaType, mimeType, width: metadata.width, height: metadata.height } as const;
  } catch {
    return { ok: false, error: { code: "INVALID_MEDIA_METADATA", message: "无法解析图片资源" } } as const;
  }
}

export async function moveUploadToStorage(upload: PersistedUpload, uploadDir: string) {
  const extension = canonicalExtension(upload.mimeType);
  if (!extension) throw new Error("unsupported media extension");
  for (;;) {
    const filename = `${randomBytes(16).toString("hex")}${extension}`;
    const target = path.join(uploadDir, filename);
    try {
      await link(upload.tempPath, target);
      return filename;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

function storedFilePath(uploadDir: string, filename: string) {
  const absolute = path.resolve(uploadDir, filename);
  const root = `${path.resolve(uploadDir)}${path.sep}`;
  if (!absolute.startsWith(root)) throw new Error("invalid storage path");
  return absolute;
}

export async function deleteStoredFile(uploadDir: string, filename: string) {
  const absolute = storedFilePath(uploadDir, filename);
  await unlink(absolute);
}

export type StagedStoredFile = { originalPath: string; stagedPath: string };

export async function stageStoredFileForDeletion(uploadDir: string, filename: string): Promise<StagedStoredFile | null> {
  const originalPath = storedFilePath(uploadDir, filename);
  const trashDir = path.join(uploadDir, ".trash");
  await mkdir(trashDir, { recursive: true });
  const stagedPath = path.join(trashDir, `${randomBytes(16).toString("hex")}.pending`);
  try {
    await rename(originalPath, stagedPath);
    return { originalPath, stagedPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function restoreStagedFile(staged: StagedStoredFile | null) {
  if (!staged) return;
  await mkdir(path.dirname(staged.originalPath), { recursive: true });
  await rename(staged.stagedPath, staged.originalPath);
}

export async function finalizeStagedFile(staged: StagedStoredFile | null) {
  if (staged) await unlink(staged.stagedPath);
}

export async function createMediaAsset(
  prisma: AppPrismaClient,
  input: {
    resourceName: string;
    tags: string[];
    upload: PersistedUpload;
    filename: string;
    mediaType: MediaType;
    width: number;
    height: number;
    createdBy?: number;
  }
) {
  const name = normalizeResourceName(input.resourceName);
  const tags = normalizeMediaTags(input.tags);
  return prisma.mediaAsset.create({
    data: {
      resourceName: name.displayName,
      resourceNameKey: name.key,
      originalName: input.upload.originalName,
      filename: input.filename,
      md5: input.upload.md5,
      mimeType: input.upload.mimeType,
      mediaType: input.mediaType,
      legacyUsage: "legacy",
      url: localMediaStoredUrl(input.filename),
      width: input.width,
      height: input.height,
      size: input.upload.size,
      storageType: "local",
      createdBy: input.createdBy,
      tags: {
        create: tags.map((label) => ({ label, labelKey: normalizeResourceName(label).key }))
      }
    },
    include: { tags: true }
  });
}

export async function fileExists(filename: string) {
  return stat(filename).then(() => true).catch(() => false);
}
