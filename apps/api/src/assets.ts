import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeResourceName } from "@event-arts/shared";
import sharp from "sharp";
import type { AppPrismaClient } from "./db";
import { localMediaStoredUrl } from "./media-url";

sharp.cache(false);
sharp.concurrency(1);

export type SeedAssetSpec = {
  key: string;
  relativePath: string;
  recoveryCommand: "pnpm assets:slice" | "pnpm assets:slice:artists" | "pnpm assets:slice:artist-detail";
  mediaType: "image" | "video";
  mimeType: "image/png" | "video/mp4";
  width?: number;
  height?: number;
};

const coreImageNames = [
  "banner-default.png", "placeholder-banner.png", "placeholder-icon.png", "placeholder-case.png",
  "icon-host.png", "icon-singer.png", "icon-actor.png", "icon-case.png", "icon-contact.png",
  "case-1.png", "case-2.png", "case-3.png",
  "artist-cover-01.png", "artist-cover-02.png", "artist-cover-03.png", "artist-cover-04.png", "artist-cover-05.png", "artist-cover-06.png"
] as const;

const detailImageNames = [
  "banner-linran-balanced.png", "banner-linran-close.png", "banner-linran-wide.png",
  "advantage-experience.png", "advantage-scenes.png", "advantage-control.png", "advantage-mandarin.png",
  "case-shangri-la-wedding.png", "case-brand-launch.png", "case-annual-gala.png", "case-lawn-wedding.png", "case-appreciation-dinner.png",
  "process-communication.png", "process-plan.png", "process-schedule.png", "process-execution.png", "process-followup.png",
  "customer-xiaoquexing.png", "customer-leon.png", "review-wedding.png", "review-conference.png",
  "icon-crown.png", "icon-location.png", "icon-calendar.png", "icon-question.png"
] as const;

export const seedAssetSpecs: SeedAssetSpec[] = [
  ...coreImageNames.map((filename) => ({
    key: `asset.core.${filename}`,
    relativePath: filename,
    recoveryCommand: filename.startsWith("artist-cover-") ? "pnpm assets:slice:artists" as const : "pnpm assets:slice" as const,
    mediaType: "image" as const,
    mimeType: "image/png" as const
  })),
  ...detailImageNames.map((filename) => ({
    key: `asset.artist-detail.${filename}`,
    relativePath: `artist-detail/${filename}`,
    recoveryCommand: "pnpm assets:slice:artist-detail" as const,
    mediaType: "image" as const,
    mimeType: "image/png" as const
  })),
  {
    key: "asset.artist-detail.detail-case-demo.mp4",
    relativePath: "artist-detail/detail-case-demo.mp4",
    recoveryCommand: "pnpm assets:slice:artist-detail",
    mediaType: "video",
    mimeType: "video/mp4",
    width: 16,
    height: 16
  }
];

async function readRequiredSeedAsset(source: string, spec: SeedAssetSpec) {
  try {
    return await readFile(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`种子资源文件不存在：${source}。请先运行 ${spec.recoveryCommand}`);
    }
    throw error;
  }
}

async function ensureSeedAssetFile(source: string, target: string, expectedMd5: string) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existingMd5 = createHash("md5").update(await readFile(target)).digest("hex");
    if (existingMd5 !== expectedMd5) throw new Error(`种子资源目标文件内容冲突：${target}`);
  }
}

export async function registerSeedAssets(
  prisma: AppPrismaClient,
  options: { assetRoot: string; uploadDir: string; publicBaseUrl: string; createdBy?: number | null; specs?: SeedAssetSpec[] }
) {
  const assets = new Map<string, { id: number; url: string; mediaType: string }>();
  for (const spec of options.specs ?? seedAssetSpecs) {
    const source = path.join(options.assetRoot, spec.relativePath);
    const buffer = await readRequiredSeedAsset(source, spec);
    const md5 = createHash("md5").update(buffer).digest("hex");
    const identity = await prisma.seedRecord.findUnique({ where: { key: spec.key } });
    let asset = identity?.entityType === "mediaAsset"
      ? await prisma.mediaAsset.findUnique({ where: { id: identity.entityId } })
      : null;
    asset ??= await prisma.mediaAsset.findUnique({ where: { md5 } });

    const originalName = path.basename(spec.relativePath);
    const normalizedName = normalizeResourceName(originalName);
    const extension = path.extname(originalName).toLowerCase();
    const storageFilename = `seed/${md5}${extension}`;
    const target = path.join(options.uploadDir, storageFilename);
    await ensureSeedAssetFile(source, target, md5);
    const metadata = spec.mediaType === "image" ? await sharp(buffer).metadata() : null;
    const dimensions = {
      width: metadata?.width ?? spec.width ?? null,
      height: metadata?.height ?? spec.height ?? null
    };
    const data = {
      resourceName: normalizedName.displayName,
      resourceNameKey: normalizedName.key,
      originalName,
      filename: storageFilename,
      md5,
      mimeType: spec.mimeType,
      mediaType: spec.mediaType,
      legacyUsage: "legacy",
      url: localMediaStoredUrl(storageFilename),
      width: dimensions.width,
      height: dimensions.height,
      size: buffer.length,
      storageType: "local",
      createdBy: options.createdBy ?? null
    };
    if (asset) {
      asset = await prisma.mediaAsset.update({ where: { id: asset.id }, data });
    } else {
      const nameOwner = await prisma.mediaAsset.findUnique({ where: { resourceNameKey: normalizedName.key } });
      const uniqueName = nameOwner ? normalizeResourceName(`${originalName} (${md5.slice(0, 8)})`) : normalizedName;
      asset = await prisma.mediaAsset.create({ data: { ...data, resourceName: uniqueName.displayName, resourceNameKey: uniqueName.key } });
    }
    await prisma.seedRecord.upsert({
      where: { key: spec.key },
      update: { entityType: "mediaAsset", entityId: asset.id },
      create: { key: spec.key, entityType: "mediaAsset", entityId: asset.id }
    });
    assets.set(originalName, asset);
  }
  return assets;
}
