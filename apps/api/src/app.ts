import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import {
  ArtistTypeSchema,
  BannerLinkTypeSchema,
  MediaUsageSchema,
  MenuTypeSchema,
  fail,
  mediaDimensionRules,
  ok,
  pageViewRequestSchema
} from "@event-arts/shared";
import type { AppPrismaClient } from "./db";
import { verifyPassword } from "./security";

type BuildOptions = {
  prisma: AppPrismaClient;
  jwtSecret: string;
  uploadDir: string;
  publicBaseUrl: string;
};

type AdminRequest = FastifyRequest & {
  admin?: { id: number; username: string };
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).headers(jsonHeaders).send(fail(code, message));
}

function parseJson(value: string | null | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = date.getDay() || 7;
  const start = startOfDay(date);
  start.setDate(start.getDate() - day + 1);
  return start;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

async function assetUrl(prisma: AppPrismaClient, id: number | null | undefined) {
  if (!id) return "";
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  return asset?.url ?? "";
}

async function mediaInUse(prisma: AppPrismaClient, id: number) {
  const [site, banners, menus, cases, artists] = await Promise.all([
    prisma.siteConfig.count({
      where: {
        OR: [
          { defaultBannerAssetId: id },
          { placeholderBannerAssetId: id },
          { placeholderIconAssetId: id },
          { placeholderCaseAssetId: id }
        ]
      }
    }),
    prisma.banner.count({ where: { imageAssetId: id } }),
    prisma.menuItem.count({ where: { iconAssetId: id } }),
    prisma.activityCase.count({ where: { coverAssetId: id } }),
    prisma.artist.count({ where: { avatarAssetId: id } })
  ]);
  return site + banners + menus + cases + artists > 0;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { prisma } = options;

  await mkdir(options.uploadDir, { recursive: true });
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: options.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: options.uploadDir,
    prefix: "/uploads/",
    decorateReply: false
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return sendError(reply, statusCode, "INTERNAL_ERROR", error.message || "服务异常");
  });

  async function requireAdmin(request: AdminRequest, reply: FastifyReply) {
    try {
      const decoded = await request.jwtVerify<{ id: number; username: string }>();
      const admin = await prisma.adminUser.findFirst({
        where: { id: decoded.id, status: "enabled" }
      });
      if (!admin) throw new Error("missing admin");
      request.admin = { id: admin.id, username: admin.username };
    } catch {
      return sendError(reply, 401, "UNAUTHORIZED", "请先登录");
    }
  }

  app.post("/api/admin/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    const admin = await prisma.adminUser.findUnique({ where: { username: body.username ?? "" } });
    if (!admin || admin.status !== "enabled" || !verifyPassword(body.password ?? "", admin.passwordHash)) {
      return sendError(reply, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    const token = app.jwt.sign({ id: admin.id, username: admin.username }, { expiresIn: "7d" });
    return reply.send(ok({ token, id: admin.id, username: admin.username }));
  });

  app.post("/api/admin/auth/logout", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(ok({}));
  });

  app.get("/api/admin/auth/me", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    return reply.send(ok(request.admin));
  });

  app.get("/api/admin/dashboard/overview", { preHandler: requireAdmin }, async (_request, reply) => {
    const now = new Date();
    const [todayPv, weekPv, monthPv] = await Promise.all([
      prisma.pageViewEvent.count({ where: { createdAt: { gte: startOfDay(now) } } }),
      prisma.pageViewEvent.count({ where: { createdAt: { gte: startOfWeek(now) } } }),
      prisma.pageViewEvent.count({ where: { createdAt: { gte: startOfMonth(now) } } })
    ]);
    return reply.send(ok({ todayPv, weekPv, monthPv }));
  });

  app.get("/api/client/home", async (_request, reply) => {
    const site = await prisma.siteConfig.findFirst({ where: { id: 1 } });
    const [announcements, banners, menus, featuredCases] = await Promise.all([
      prisma.announcement.findMany({ where: { status: "enabled" }, orderBy: { sortOrder: "asc" } }),
      prisma.banner.findMany({
        where: { status: "enabled" },
        include: { imageAsset: true },
        orderBy: { sortOrder: "asc" }
      }),
      prisma.menuItem.findMany({
        where: { status: "enabled" },
        include: { iconAsset: true },
        orderBy: { sortOrder: "asc" }
      }),
      prisma.activityCase.findMany({
        where: { status: "enabled", isFeatured: true },
        include: { coverAsset: true },
        orderBy: { featuredSortOrder: "asc" }
      })
    ]);

    return reply.send(
      ok({
        site: {
          appName: site?.appName ?? "",
          subtitle: site?.subtitle ?? "",
          defaultBannerUrl: await assetUrl(prisma, site?.defaultBannerAssetId),
          placeholderBannerUrl: await assetUrl(prisma, site?.placeholderBannerAssetId),
          placeholderIconUrl: await assetUrl(prisma, site?.placeholderIconAssetId),
          placeholderCaseUrl: await assetUrl(prisma, site?.placeholderCaseAssetId)
        },
        announcements,
        banners: banners.map((banner) => ({ ...banner, imageUrl: banner.imageAsset.url })),
        menus: menus.map((menu) => ({ ...menu, iconUrl: menu.iconAsset.url, configJson: parseJson(menu.configJson) })),
        featuredCases: featuredCases.map((item) => ({
          ...item,
          eventDate: toIsoDate(item.eventDate),
          coverUrl: item.coverAsset.url,
          mediaJson: parseJson(item.mediaJson)
        }))
      })
    );
  });

  app.post("/api/client/track/page-view", async (request, reply) => {
    const parsed = pageViewRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "页面统计参数错误");
    await prisma.pageViewEvent.create({
      data: {
        pagePath: parsed.data.pagePath,
        scene: parsed.data.scene,
        userAgent: request.headers["user-agent"]
      }
    });
    return reply.send(ok({}));
  });

  app.get("/api/client/announcements/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.announcement.findFirst({ where: { id, status: "enabled" } });
    return item ? reply.send(ok(item)) : sendError(reply, 404, "NOT_FOUND", "公告不存在");
  });

  app.get("/api/client/cases", async (_request, reply) => {
    const items = await prisma.activityCase.findMany({
      where: { status: "enabled" },
      include: { coverAsset: true },
      orderBy: { sortOrder: "asc" }
    });
    return reply.send(
      ok(items.map((item) => ({ ...item, coverUrl: item.coverAsset.url, eventDate: toIsoDate(item.eventDate) })))
    );
  });

  app.get("/api/client/cases/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.activityCase.findFirst({
      where: { id, status: "enabled" },
      include: { coverAsset: true }
    });
    return item
      ? reply.send(ok({ ...item, coverUrl: item.coverAsset.url, eventDate: toIsoDate(item.eventDate) }))
      : sendError(reply, 404, "NOT_FOUND", "案例不存在");
  });

  app.get("/api/client/artists", async (request, reply) => {
    const type = (request.query as { type?: string }).type;
    const items = await prisma.artist.findMany({
      where: { status: "enabled", ...(type ? { type } : {}) },
      include: { avatarAsset: true },
      orderBy: { sortOrder: "asc" }
    });
    return reply.send(ok(items.map((item) => ({ ...item, avatarUrl: item.avatarAsset?.url ?? null }))));
  });

  app.get("/api/client/artists/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.artist.findFirst({ where: { id, status: "enabled" }, include: { avatarAsset: true } });
    return item
      ? reply.send(ok({ ...item, avatarUrl: item.avatarAsset?.url ?? null }))
      : sendError(reply, 404, "NOT_FOUND", "人员不存在");
  });

  app.get("/api/admin/site-config", { preHandler: requireAdmin }, async (_request, reply) => {
    const site = await prisma.siteConfig.findFirst({ where: { id: 1 } });
    return reply.send(ok(site));
  });

  app.put("/api/admin/site-config", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const site = await prisma.siteConfig.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, appName: String(body.appName ?? ""), subtitle: String(body.subtitle ?? ""), ...body }
    });
    return reply.send(ok(site));
  });

  app.get("/api/admin/media-assets", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.mediaAsset.findMany({ orderBy: { createdAt: "desc" } });
    return reply.send(ok({ items, total: items.length }));
  });

  app.post("/api/admin/media-assets/upload", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    let usage = "";
    let fileBuffer: Buffer | null = null;
    let originalName = "";
    let mimeType = "";

    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "usage") usage = String(part.value);
      if (part.type === "file" && part.fieldname === "file") {
        originalName = part.filename;
        mimeType = part.mimetype;
        fileBuffer = await part.toBuffer();
      }
    }

    const parsedUsage = MediaUsageSchema.safeParse(usage);
    if (!parsedUsage.success || !fileBuffer) {
      return sendError(reply, 400, "VALIDATION_ERROR", "上传文件和资源用途不能为空");
    }

    const mediaType = mimeType.startsWith("video/") ? "video" : "image";
    let width: number | null = null;
    let height: number | null = null;

    if (mediaType === "image") {
      const metadata = await sharp(fileBuffer).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
      const rule = mediaDimensionRules[parsedUsage.data];
      if (rule && (width !== rule.width || height !== rule.height)) {
        return sendError(reply, 400, "INVALID_IMAGE_DIMENSION", `图片尺寸必须为 ${rule.width}x${rule.height}`);
      }
    }

    const extension = path.extname(originalName) || (mediaType === "video" ? ".mp4" : ".png");
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
    await writeFile(path.join(options.uploadDir, filename), fileBuffer);
    const asset = await prisma.mediaAsset.create({
      data: {
        originalName,
        filename,
        mimeType,
        mediaType,
        usage: parsedUsage.data,
        url: `${options.publicBaseUrl}/uploads/${filename}`,
        width,
        height,
        size: fileBuffer.length,
        storageType: "local",
        createdBy: request.admin?.id
      }
    });
    return reply.send(ok(asset));
  });

  app.delete("/api/admin/media-assets/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return sendError(reply, 404, "NOT_FOUND", "资源不存在");
    if (await mediaInUse(prisma, id)) {
      return sendError(reply, 409, "MEDIA_IN_USE", "资源正在被使用，无法删除");
    }
    await prisma.mediaAsset.delete({ where: { id } });
    await unlink(path.join(options.uploadDir, asset.filename)).catch(() => undefined);
    return reply.send(ok({}));
  });

  registerCrud(app, prisma, requireAdmin);

  return app;
}

function registerCrud(
  app: FastifyInstance,
  prisma: AppPrismaClient,
  requireAdmin: (request: AdminRequest, reply: FastifyReply) => Promise<unknown>
) {
  app.get("/api/admin/announcements", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.announcement.findMany({ orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/announcements", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const item = await prisma.announcement.create({ data: body as never });
    return reply.send(ok(item));
  });
  app.put("/api/admin/announcements/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.announcement.update({ where: { id }, data: request.body as never });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/announcements/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.announcement.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/banners", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.banner.findMany({ include: { imageAsset: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/banners", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const parsed = BannerLinkTypeSchema.safeParse(body.linkType ?? "none");
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "Banner 跳转类型错误");
    const item = await prisma.banner.create({ data: body as never });
    return reply.send(ok(item));
  });
  app.put("/api/admin/banners/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const item = await prisma.banner.update({
      where: { id: Number((request.params as { id: string }).id) },
      data: request.body as never
    });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/banners/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.banner.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/menu-items", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.menuItem.findMany({ include: { iconAsset: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/menu-items", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const parsed = MenuTypeSchema.safeParse(body.type);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "菜单类型错误");
    const item = await prisma.menuItem.create({
      data: { ...body, configJson: JSON.stringify(body.configJson ?? {}) } as never
    });
    return reply.send(ok(item));
  });
  app.put("/api/admin/menu-items/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const item = await prisma.menuItem.update({
      where: { id: Number((request.params as { id: string }).id) },
      data: { ...body, configJson: JSON.stringify(body.configJson ?? {}) } as never
    });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/menu-items/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.menuItem.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/cases", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.activityCase.findMany({ include: { coverAsset: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/cases", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const item = await prisma.activityCase.create({
      data: {
        ...body,
        eventDate: new Date(String(body.eventDate)),
        mediaJson: JSON.stringify(body.mediaJson ?? [])
      } as never
    });
    return reply.send(ok(item));
  });
  app.put("/api/admin/cases/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const item = await prisma.activityCase.update({
      where: { id: Number((request.params as { id: string }).id) },
      data: { ...body, mediaJson: JSON.stringify(body.mediaJson ?? []) } as never
    });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/cases/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.activityCase.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/artists", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.artist.findMany({ include: { avatarAsset: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/artists", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const parsed = ArtistTypeSchema.safeParse(body.type);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "人员类型错误");
    const item = await prisma.artist.create({ data: { ...body, tagsJson: JSON.stringify(body.tagsJson ?? []) } as never });
    return reply.send(ok(item));
  });
  app.put("/api/admin/artists/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const item = await prisma.artist.update({
      where: { id: Number((request.params as { id: string }).id) },
      data: { ...body, tagsJson: JSON.stringify(body.tagsJson ?? []) } as never
    });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/artists/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.artist.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });
}
