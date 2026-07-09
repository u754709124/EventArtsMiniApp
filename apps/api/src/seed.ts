import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppPrismaClient } from "./db";
import { hashPassword } from "./security";

type SeedOptions = {
  uploadDir: string;
  publicBaseUrl: string;
  reset?: boolean;
};

const assetRoot = path.resolve(process.cwd(), "../../apps/miniapp/src/assets/generated");

async function copySeedAsset(uploadDir: string, filename: string) {
  await mkdir(path.join(uploadDir, "seed"), { recursive: true });
  const source = path.join(assetRoot, filename);
  const target = path.join(uploadDir, "seed", filename);
  await copyFile(source, target).catch(async () => {
    await mkdir(path.dirname(target), { recursive: true });
  });
}

async function resetDatabase(prisma: AppPrismaClient) {
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
    ["banner-default.png", "banner", 1420, 580],
    ["placeholder-banner.png", "placeholder_banner", 1420, 580],
    ["placeholder-icon.png", "placeholder_icon", 176, 176],
    ["placeholder-case.png", "placeholder_case", 460, 320],
    ["icon-host.png", "menu_icon", 176, 176],
    ["icon-singer.png", "menu_icon", 176, 176],
    ["icon-actor.png", "menu_icon", 176, 176],
    ["icon-case.png", "menu_icon", 176, 176],
    ["icon-contact.png", "menu_icon", 176, 176],
    ["case-1.png", "case_cover", 460, 320],
    ["case-2.png", "case_cover", 460, 320],
    ["case-3.png", "case_cover", 460, 320]
  ] as const;

  const assets = new Map<string, { id: number; url: string }>();
  for (const [filename, usage, width, height] of files) {
    await copySeedAsset(options.uploadDir, filename);
    const asset = await prisma.mediaAsset.upsert({
      where: { filename: `seed-${filename}` },
      update: {},
      create: {
        originalName: filename,
        filename: `seed-${filename}`,
        mimeType: "image/png",
        mediaType: "image",
        usage,
        url: `${options.publicBaseUrl}/uploads/seed/${filename}`,
        width,
        height,
        size: 1,
        storageType: "local",
        createdBy: admin.id
      }
    });
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

  await prisma.announcement.create({
    data: {
      summary: "最新档期更新",
      content: "婚礼主持、商演主持、歌手演出可预约",
      displayDurationMs: 3000,
      sortOrder: 1,
      status: "enabled"
    }
  });

  await prisma.banner.create({
    data: {
      title: "高端婚礼与活动主持服务",
      imageAssetId: assets.get("banner-default.png")!.id,
      linkType: "none",
      switchDurationMs: 3500,
      sortOrder: 1,
      status: "enabled"
    }
  });

  const menus = [
    ["主持人", "icon-host.png", "host", { defaultSort: "sortOrder", pageSize: 10 }],
    ["歌手", "icon-singer.png", "singer", { defaultSort: "sortOrder", pageSize: 10 }],
    ["演员", "icon-actor.png", "actor", { defaultSort: "sortOrder", pageSize: 10 }],
    ["活动案例", "icon-case.png", "activity_case", { onlyFeatured: false, pageSize: 10 }],
    ["联系我们", "icon-contact.png", "contact", { phone: "13800000000", address: "杭州" }]
  ] as const;

  for (const [index, [text, icon, type, config]] of menus.entries()) {
    await prisma.menuItem.create({
      data: {
        text,
        iconAssetId: assets.get(icon)!.id,
        type,
        configJson: JSON.stringify(config),
        sortOrder: index + 1,
        status: "enabled"
      }
    });
  }

  const cases = [
    ["浪漫粉色系户外婚礼", "婚礼主持", "婚礼主持", "case-1.png", "温馨浪漫的户外草坪婚礼，见证新人的幸福时刻。", "2024-05-18", "杭州・西湖区"],
    ["企业年会歌手演出", "歌手演出", "歌手演出", "case-2.png", "实力歌手倾情献唱，点燃全场氛围。", "2024-01-20", "上海・浦东"],
    ["高空绸吊杂技表演", "杂技表演", "杂技表演", "case-3.png", "惊险与美感并存的高空绸吊，打造震撼视觉盛宴。", "2024-03-12", "宁波・鄞州"]
  ] as const;

  for (const [index, item] of cases.entries()) {
    const [title, category, tag, cover, summary, eventDate, location] = item;
    await prisma.activityCase.create({
      data: {
        title,
        category,
        tag,
        coverAssetId: assets.get(cover)!.id,
        summary,
        eventDate: new Date(`${eventDate}T00:00:00.000Z`),
        location,
        detail: `${title}详情内容`,
        mediaJson: JSON.stringify([]),
        isFeatured: true,
        featuredSortOrder: index + 1,
        sortOrder: index + 1,
        status: "enabled"
      }
    });
  }

  const artists = [
    ["资深婚礼主持人", "host"],
    ["实力女歌手", "singer"],
    ["杂技演员", "actor"]
  ] as const;

  for (const [index, [name, type]] of artists.entries()) {
    await prisma.artist.create({
      data: {
        name,
        type,
        avatarAssetId: null,
        summary: `${name}，经验丰富，风格稳定。`,
        tagsJson: JSON.stringify(["专业", "稳定"]),
        detail: `${name}详情介绍`,
        sortOrder: index + 1,
        status: "enabled"
      }
    });
  }
}
