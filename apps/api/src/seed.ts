import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeResourceName, serializeArtistTags, type ArtistType } from "@event-arts/shared";
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
    "case-3.png",
    "artist-cover-01.png",
    "artist-cover-02.png",
    "artist-cover-03.png",
    "artist-cover-04.png",
    "artist-cover-05.png",
    "artist-cover-06.png"
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

  const legacyArtists = [
    ["artist.host", "资深婚礼主持人", "host"],
    ["artist.singer", "实力女歌手", "singer"],
    ["artist.actor", "杂技演员", "actor"]
  ] as const;
  for (const [key, name, type] of legacyArtists) {
    const record = await prisma.seedRecord.findUnique({ where: { key } });
    if (!record) continue;
    const artist = await prisma.artist.findUnique({ where: { id: record.entityId } });
    if (artist?.name === name && artist.type === type) await prisma.artist.delete({ where: { id: artist.id } });
    await prisma.seedRecord.delete({ where: { key } });
  }

  const artists: Array<{
    name: string;
    type: ArtistType;
    cover: (typeof files)[number];
    location: string;
    badge: string;
    tags: string[];
    summary: string;
    detail: string;
    sortOrder: number;
  }> = [
    {
      name: "林然",
      type: "host",
      cover: "artist-cover-01.png",
      location: "杭州",
      badge: "金牌主持",
      tags: ["10年经验", "婚礼主持", "高端晚宴", "控场力强"],
      summary: "风格大气沉稳，擅长情感共鸣，深受新人喜爱，让每一场仪式都温暖动人。",
      detail: "林然拥有十年婚礼与高端晚宴主持经验，擅长以真诚表达串联仪式每一个动人瞬间。",
      sortOrder: 1
    },
    {
      name: "Jessica",
      type: "host",
      cover: "artist-cover-02.png",
      location: "深圳",
      badge: "人气主持",
      tags: ["6年经验", "中英双语", "国际活动", "气质优雅"],
      summary: "中英双语主持，台风大方得体，擅长国际活动与高端晚宴主持。",
      detail: "Jessica 善于用流利的双语表达与优雅节奏，为国际活动和品牌晚宴营造从容氛围。",
      sortOrder: 2
    },
    {
      name: "陆安",
      type: "host",
      cover: "artist-cover-03.png",
      location: "上海",
      badge: "实力主持",
      tags: ["8年经验", "论坛主持", "沉稳大气", "逻辑清晰"],
      summary: "语言表达精准有力，擅长大型论坛、发布会及企业活动，掌控全场节奏。",
      detail: "陆安专注论坛、发布会与企业活动主持，以清晰逻辑和稳定台风把握整场节奏。",
      sortOrder: 3
    },
    {
      name: "沈悦",
      type: "host",
      cover: "artist-cover-04.png",
      location: "广州",
      badge: "高端主持",
      tags: ["7年经验", "婚礼主持", "亲和力强", "温暖细腻"],
      summary: "风格温暖细腻，亲和力强，善于捕捉情感瞬间，打造难忘的幸福仪式。",
      detail: "沈悦以细腻观察和自然互动见长，能让每一场婚礼都留下温暖而独特的记忆。",
      sortOrder: 4
    },
    {
      name: "Kevin",
      type: "host",
      cover: "artist-cover-05.png",
      location: "北京",
      badge: "双语主持",
      tags: ["5年经验", "中英双语", "商务活动", "风格国际"],
      summary: "中英双语流利，擅长商务峰会、品牌发布会及国际交流活动，专业高效。",
      detail: "Kevin 长期服务商务峰会和品牌发布会，以国际化表达支持多语言沟通场景。",
      sortOrder: 5
    },
    {
      name: "余薇",
      type: "host",
      cover: "artist-cover-06.png",
      location: "成都",
      badge: "资深主持",
      tags: ["12年经验", "年会主持", "控场力强", "经验丰富"],
      summary: "经验丰富，控场力出色，擅长大型年会、晚宴及各类庆典活动。",
      detail: "余薇拥有十二年大型活动经验，能以从容节奏带动年会、晚宴和庆典现场。",
      sortOrder: 6
    },
    {
      name: "苏晴",
      type: "singer",
      cover: "artist-cover-01.png",
      location: "杭州",
      badge: "金嗓歌手",
      tags: ["10年驻唱", "流行演唱", "婚礼暖场", "情感细腻"],
      summary: "声线温暖通透，擅长流行与抒情歌曲，为婚礼和晚宴带来细腻动人的现场演唱。",
      detail: "苏晴拥有丰富的舞台与婚礼演出经历，可根据仪式节奏定制暖场与献唱曲目。",
      sortOrder: 1
    },
    {
      name: "Daniel",
      type: "singer",
      cover: "artist-cover-02.png",
      location: "深圳",
      badge: "双语歌手",
      tags: ["中英双语", "爵士流行", "品牌活动", "现场互动"],
      summary: "中英双语演唱自然流畅，擅长爵士与流行风格，为品牌活动营造轻松高级的氛围。",
      detail: "Daniel 可完成双语曲目串联与轻量互动演出，适配品牌酒会、发布会和国际交流活动。",
      sortOrder: 2
    },
    {
      name: "陈默",
      type: "singer",
      cover: "artist-cover-03.png",
      location: "上海",
      badge: "实力唱将",
      tags: ["摇滚流行", "乐队主唱", "企业年会", "爆发力强"],
      summary: "舞台爆发力出色，擅长摇滚与流行现场，以充满能量的演唱点燃企业年会。",
      detail: "陈默长期担任乐队主唱，拥有成熟的现场调度能力，适合节奏热烈的庆典舞台。",
      sortOrder: 3
    },
    {
      name: "安娜",
      type: "singer",
      cover: "artist-cover-04.png",
      location: "广州",
      badge: "晚宴歌手",
      tags: ["爵士演唱", "晚宴演出", "气质优雅", "曲风多元"],
      summary: "优雅声线与细腻台风兼具，擅长爵士、灵魂乐和经典流行曲目。",
      detail: "安娜可为高端晚宴打造舒缓而有层次的音乐段落，并提供曲目策划建议。",
      sortOrder: 4
    },
    {
      name: "许诺",
      type: "singer",
      cover: "artist-cover-05.png",
      location: "北京",
      badge: "原创歌手",
      tags: ["民谣流行", "原创音乐", "校园活动", "互动感强"],
      summary: "声音清澈真诚，擅长民谣与原创流行作品，现场互动自然有感染力。",
      detail: "许诺适合校园、社群和品牌快闪活动，可通过原创与翻唱曲目拉近舞台距离。",
      sortOrder: 5
    },
    {
      name: "唐艺",
      type: "singer",
      cover: "artist-cover-06.png",
      location: "成都",
      badge: "氛围歌手",
      tags: ["R&B演唱", "酒会现场", "情绪表达", "风格时尚"],
      summary: "音色松弛有质感，擅长 R&B 与都市流行，为酒会与派对增添时尚氛围。",
      detail: "唐艺能根据场地与客群调整演出强度，提供兼具聆听感和节奏感的演出体验。",
      sortOrder: 6
    },
    {
      name: "周野",
      type: "actor",
      cover: "artist-cover-01.png",
      location: "杭州",
      badge: "舞台演员",
      tags: ["话剧表演", "品牌发布", "角色塑造", "台词扎实"],
      summary: "舞台表现沉稳有张力，擅长话剧片段、品牌发布会情景演绎与角色塑造。",
      detail: "周野具备系统的舞台表演训练，可为品牌发布和庆典仪式提供定制化剧情演绎。",
      sortOrder: 1
    },
    {
      name: "林雪",
      type: "actor",
      cover: "artist-cover-02.png",
      location: "深圳",
      badge: "形象演员",
      tags: ["礼仪走秀", "影视表演", "活动接待", "镜头感强"],
      summary: "镜头感与亲和力兼具，擅长礼仪走秀、影视短片和品牌活动形象展示。",
      detail: "林雪可配合品牌视觉完成静态展示、走秀互动与短片角色演绎，现场配合度高。",
      sortOrder: 2
    },
    {
      name: "顾言",
      type: "actor",
      cover: "artist-cover-03.png",
      location: "上海",
      badge: "实力演员",
      tags: ["即兴表演", "互动戏剧", "企业团建", "反应敏捷"],
      summary: "擅长即兴互动与沉浸式戏剧，在企业团建和主题活动中带动参与热情。",
      detail: "顾言拥有丰富的互动剧场经验，能快速理解活动主题并与观众建立自然连接。",
      sortOrder: 3
    },
    {
      name: "沈宁",
      type: "actor",
      cover: "artist-cover-04.png",
      location: "广州",
      badge: "古风演员",
      tags: ["古风演绎", "国潮活动", "舞台剧", "形体优美"],
      summary: "形体优雅、气质鲜明，擅长国潮主题、古风情景剧和文化活动演绎。",
      detail: "沈宁可参与国风舞台剧、展陈导览和沉浸式互动，强化主题活动的叙事氛围。",
      sortOrder: 4
    },
    {
      name: "韩川",
      type: "actor",
      cover: "artist-cover-05.png",
      location: "北京",
      badge: "动作演员",
      tags: ["动作表演", "影视特技", "舞台秀", "专业训练"],
      summary: "动作干净利落，具备影视与舞台特技训练，可完成力量感十足的主题表演。",
      detail: "韩川适合运动品牌、科技发布和大型舞台秀，可结合编排完成节奏鲜明的动作演绎。",
      sortOrder: 5
    },
    {
      name: "余曼",
      type: "actor",
      cover: "artist-cover-06.png",
      location: "成都",
      badge: "多栖演员",
      tags: ["影视表演", "短剧演绎", "商业拍摄", "角色多变"],
      summary: "角色适配度高，擅长商业短剧、影视片段与品牌内容拍摄，表现自然灵动。",
      detail: "余曼可根据脚本快速进入角色，支持活动预热短片、现场情景剧和品牌内容制作。",
      sortOrder: 6
    }
  ];

  for (const artist of artists) {
    const { name, type, cover, location, badge, tags, summary, detail, sortOrder } = artist;
    const data = {
      name,
      type,
      avatarAssetId: assets.get(cover)!.id,
      location,
      badge,
      summary,
      tagsJson: serializeArtistTags(tags),
      detail,
      sortOrder,
      status: "enabled"
    };
    await upsertSeedEntity(prisma, {
      key: `artist.${type}.${sortOrder}`,
      entityType: "artist",
      findById: (id) => prisma.artist.findUnique({ where: { id } }),
      findLegacy: () => prisma.artist.findFirst({ where: { name, type } }),
      create: () => prisma.artist.create({ data }),
      update: (id) => prisma.artist.update({ where: { id }, data })
    });
  }
}
