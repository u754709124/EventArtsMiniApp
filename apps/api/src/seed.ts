import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeResourceName } from "@event-arts/shared";
import sharp from "sharp";
import type { AppPrismaClient } from "./db";
import { hashPassword } from "./security";

type SeedOptions = {
  uploadDir: string;
  publicBaseUrl: string;
  reset?: boolean;
};

const assetRoot = path.resolve(process.cwd(), "../../apps/miniapp/src/assets/generated");

async function ensureSeedAssetFile(source: string, target: string, expectedMd5: string) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existingMd5 = createHash("md5").update(await readFile(target)).digest("hex");
    if (existingMd5 !== expectedMd5) throw new Error(`种子资源目标文件内容冲突：${target}`);
    return false;
  }
}

async function resetDatabase(prisma: AppPrismaClient) {
  await prisma.seedRecord.deleteMany();
  await prisma.operationLog.deleteMany();
  await prisma.pageViewEvent.deleteMany();
  await prisma.activityCase.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.banner.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.siteConfig.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.adminUser.deleteMany();
}

type SeedEntity = { id: number };

async function upsertSeedEntity<T extends SeedEntity>(
  prisma: AppPrismaClient,
  options: {
    key: string;
    entityType: string;
    findById: (id: number) => Promise<T | null>;
    findLegacy: () => Promise<T | null>;
    create: () => Promise<T>;
    update: (id: number) => Promise<T>;
  }
) {
  const identity = await prisma.seedRecord.findUnique({ where: { key: options.key } });
  let existing = identity ? await options.findById(identity.entityId) : null;
  if (!identity) existing = await options.findLegacy();
  const entity = existing ? await options.update(existing.id) : await options.create();
  await prisma.seedRecord.upsert({
    where: { key: options.key },
    update: { entityType: options.entityType, entityId: entity.id },
    create: { key: options.key, entityType: options.entityType, entityId: entity.id }
  });
  return entity;
}

export async function seedDatabase(prisma: AppPrismaClient, options: SeedOptions) {
  if (options.reset) {
    await resetDatabase(prisma);
  }

  const admin = await prisma.adminUser.upsert({
    where: { username: "admin" },
    update: {
      passwordHash: hashPassword("admin123456", "event-arts-admin"),
      status: "enabled"
    },
    create: {
      username: "admin",
      passwordHash: hashPassword("admin123456", "event-arts-admin"),
      status: "enabled"
    }
  });

  const files = [
    "banner-default.png",
    "placeholder-banner.png",
    "placeholder-icon.png",
    "placeholder-case.png",
    "icon-host.png",
    "icon-singer.png",
    "icon-actor.png",
    "icon-case.png",
    "icon-contact.png",
    "case-1.png",
    "case-2.png",
    "case-3.png"
  ] as const;

  const assets = new Map<string, { id: number; url: string }>();
  for (const filename of files) {
    const source = path.join(assetRoot, filename);
    const buffer = await readFile(source);
    const metadata = await sharp(buffer).metadata();
    const md5 = createHash("md5").update(buffer).digest("hex");
    const normalizedName = normalizeResourceName(filename);
    let asset = await prisma.mediaAsset.findUnique({ where: { md5 } });
    if (!asset) {
      const storageFilename = `seed/${md5}.png`;
      const target = path.join(options.uploadDir, storageFilename);
      await ensureSeedAssetFile(source, target, md5);
      const nameOwner = await prisma.mediaAsset.findUnique({ where: { resourceNameKey: normalizedName.key } });
      const uniqueName = nameOwner ? normalizeResourceName(`${filename} (${md5.slice(0, 8)})`) : normalizedName;
      try {
        asset = await prisma.mediaAsset.create({
          data: {
            resourceName: uniqueName.displayName,
            resourceNameKey: uniqueName.key,
            originalName: filename,
            filename: storageFilename,
            md5,
            mimeType: "image/png",
            mediaType: "image",
            legacyUsage: "legacy",
            url: `${options.publicBaseUrl}/uploads/${storageFilename}`,
            width: metadata.width,
            height: metadata.height,
            size: buffer.length,
            storageType: "local",
            createdBy: admin.id
          }
        });
      } catch (error) {
        const concurrentAsset = await prisma.mediaAsset.findUnique({ where: { md5 } });
        if (concurrentAsset) asset = concurrentAsset;
        else throw new Error(`种子资源写库失败，内容寻址文件已保留供安全重试：${target}`, { cause: error });
      }
    }
    assets.set(filename, asset);
  }

  await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: {
      appName: "喜缘主持・演艺服务",
      subtitle: "专业主持人・歌手・演艺团队",
      defaultBannerAssetId: assets.get("banner-default.png")?.id,
      placeholderBannerAssetId: assets.get("placeholder-banner.png")?.id,
      placeholderIconAssetId: assets.get("placeholder-icon.png")?.id,
      placeholderCaseAssetId: assets.get("placeholder-case.png")?.id
    },
    create: {
      id: 1,
      appName: "喜缘主持・演艺服务",
      subtitle: "专业主持人・歌手・演艺团队",
      defaultBannerAssetId: assets.get("banner-default.png")?.id,
      placeholderBannerAssetId: assets.get("placeholder-banner.png")?.id,
      placeholderIconAssetId: assets.get("placeholder-icon.png")?.id,
      placeholderCaseAssetId: assets.get("placeholder-case.png")?.id
    }
  });

  const announcementData = {
    summary: "最新档期更新",
    content: "婚礼主持、商演主持、歌手演出可预约",
    displayDurationMs: 3000,
    sortOrder: 1,
    status: "enabled"
  };
  await upsertSeedEntity(prisma, {
    key: "announcement.default",
    entityType: "announcement",
    findById: (id) => prisma.announcement.findUnique({ where: { id } }),
    findLegacy: () => prisma.announcement.findFirst({ where: { summary: announcementData.summary } }),
    create: () => prisma.announcement.create({ data: announcementData }),
    update: (id) => prisma.announcement.update({ where: { id }, data: announcementData })
  });

  const bannerData = {
    title: "高端婚礼与活动主持服务",
    imageAssetId: assets.get("banner-default.png")!.id,
    linkType: "none",
    switchDurationMs: 3500,
    sortOrder: 1,
    status: "enabled"
  };
  await upsertSeedEntity(prisma, {
    key: "banner.default",
    entityType: "banner",
    findById: (id) => prisma.banner.findUnique({ where: { id } }),
    findLegacy: () => prisma.banner.findFirst({ where: { title: bannerData.title } }),
    create: () => prisma.banner.create({ data: bannerData }),
    update: (id) => prisma.banner.update({ where: { id }, data: bannerData })
  });

  const menus = [
    ["主持人", "icon-host.png", "host", { defaultSort: "sortOrder", pageSize: 10 }],
    ["歌手", "icon-singer.png", "singer", { defaultSort: "sortOrder", pageSize: 10 }],
    ["演员", "icon-actor.png", "actor", { defaultSort: "sortOrder", pageSize: 10 }],
    ["活动案例", "icon-case.png", "activity_case", { onlyFeatured: false, pageSize: 10 }],
    ["联系我们", "icon-contact.png", "contact", { phone: "13800000000", address: "杭州" }]
  ] as const;

  for (const [index, [text, icon, type, config]] of menus.entries()) {
    const data = {
      text,
      iconAssetId: assets.get(icon)!.id,
      type,
      configJson: JSON.stringify(config),
      sortOrder: index + 1,
      status: "enabled"
    };
    await upsertSeedEntity(prisma, {
      key: `menu.${type}`,
      entityType: "menuItem",
      findById: (id) => prisma.menuItem.findUnique({ where: { id } }),
      findLegacy: () => prisma.menuItem.findFirst({ where: { text, type } }),
      create: () => prisma.menuItem.create({ data }),
      update: (id) => prisma.menuItem.update({ where: { id }, data })
    });
  }

  const cases = [
    ["浪漫粉色系户外婚礼", "婚礼主持", "婚礼主持", "case-1.png", "温馨浪漫的户外草坪婚礼，见证新人的幸福时刻。", "2024-05-18", "杭州・西湖区"],
    ["企业年会歌手演出", "歌手演出", "歌手演出", "case-2.png", "实力歌手倾情献唱，点燃全场氛围。", "2024-01-20", "上海・浦东"],
    ["高空绸吊杂技表演", "杂技表演", "杂技表演", "case-3.png", "惊险与美感并存的高空绸吊，打造震撼视觉盛宴。", "2024-03-12", "宁波・鄞州"]
  ] as const;

  for (const [index, item] of cases.entries()) {
    const [title, category, tag, cover, summary, eventDate, location] = item;
    const data = {
      title,
      category,
      tag,
      coverAssetId: assets.get(cover)!.id,
      summary,
      eventDate: new Date(`${eventDate}T00:00:00.000Z`),
      location,
      detail: `${title}详情内容`,
      legacyMediaJson: JSON.stringify([]),
      isFeatured: true,
      featuredSortOrder: index + 1,
      sortOrder: index + 1,
      status: "enabled"
    };
    await upsertSeedEntity(prisma, {
      key: `case.${index + 1}`,
      entityType: "activityCase",
      findById: (id) => prisma.activityCase.findUnique({ where: { id } }),
      findLegacy: () => prisma.activityCase.findFirst({ where: { title } }),
      create: () => prisma.activityCase.create({ data }),
      update: (id) => prisma.activityCase.update({ where: { id }, data })
    });
  }

  const artists = [
    ["资深婚礼主持人", "host"],
    ["实力女歌手", "singer"],
    ["杂技演员", "actor"]
  ] as const;

  for (const [index, [name, type]] of artists.entries()) {
    const data = {
      name,
      type,
      avatarAssetId: null,
      summary: `${name}，经验丰富，风格稳定。`,
      tagsJson: JSON.stringify(["专业", "稳定"]),
      detail: `${name}详情介绍`,
      sortOrder: index + 1,
      status: "enabled"
    };
    await upsertSeedEntity(prisma, {
      key: `artist.${type}`,
      entityType: "artist",
      findById: (id) => prisma.artist.findUnique({ where: { id } }),
      findLegacy: () => prisma.artist.findFirst({ where: { name, type } }),
      create: () => prisma.artist.create({ data }),
      update: (id) => prisma.artist.update({ where: { id }, data })
    });
  }
}
