import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import type { Prisma } from "@prisma/client";
import type { DetailOwnerType } from "@event-arts/shared";
import type { AppPrismaClient } from "../db";
import {
  extractRichTextMedia,
  sanitizeAndNormalizeRichText
} from "./detail-page-sanitizer";
import {
  detailPageConfigInclude,
  serializeDetailPageConfig,
  type DetailPageConfigRecord
} from "./detail-page-serializer";
import type { DetailPageMediaAsset } from "./detail-page-types";

export const DETAIL_PAGE_MIGRATION_ID = "20260710_detail_page_config_v1";

type MigrationDb = Prisma.TransactionClient;
type HtmlChildNode = DefaultTreeAdapterTypes.ChildNode;

const recognizedHtmlTags = new Set([
  "p",
  "div",
  "section",
  "span",
  "strong",
  "em",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "a",
  "img",
  "video",
  "source"
]);

function isElement(node: HtmlChildNode): node is DefaultTreeAdapterTypes.Element {
  return "tagName" in node;
}

function walkHtml(parent: { childNodes: HtmlChildNode[] }, visitor: (element: DefaultTreeAdapterTypes.Element) => void) {
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue;
    visitor(child);
    walkHtml(child, visitor);
  }
}

function looksLikeSupportedHtml(value: string) {
  let found = false;
  walkHtml(parseFragment(value), (element) => {
    if (recognizedHtmlTags.has(element.tagName)) found = true;
  });
  return found;
}

function submittedMediaIds(value: string) {
  const ids = new Set<number>();
  walkHtml(parseFragment(value), (element) => {
    if (element.tagName !== "img" && element.tagName !== "video") return;
    const raw = element.attrs.find((attribute) => attribute.name === "data-media-asset-id")?.value ?? "";
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  });
  return [...ids];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToParagraphs(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

async function loadAssets(db: MigrationDb, ids: number[]) {
  if (!ids.length) return new Map<number, DetailPageMediaAsset>();
  const rows = await db.mediaAsset.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, mediaType: true, url: true, width: true, height: true }
  });
  return new Map(rows.map((asset) => [asset.id, asset]));
}

async function migrateLegacyHtml(db: MigrationDb, legacyDetail: string, additionalAssetIds: number[] = []) {
  const trimmed = legacyDetail.trim();
  const initial = !trimmed
    ? ""
    : looksLikeSupportedHtml(trimmed)
      ? trimmed
      : plainTextToParagraphs(legacyDetail);
  const assetIds = [...new Set([...submittedMediaIds(initial), ...additionalAssetIds])];
  const assets = await loadAssets(db, assetIds);
  if (!initial) return { html: "", assets };
  return { html: sanitizeAndNormalizeRichText(initial, assets), assets };
}

function validateExistingConfig(record: DetailPageConfigRecord) {
  const config = serializeDetailPageConfig(record);
  const htmlAssetIds = [...new Set(extractRichTextMedia(record.richTextHtml).map((item) => item.assetId))].sort((a, b) => a - b);
  const relationAssetIds = [...new Set(record.contentMedia.map((item) => item.mediaAssetId))].sort((a, b) => a - b);
  if (htmlAssetIds.length !== relationAssetIds.length || htmlAssetIds.some((id, index) => id !== relationAssetIds[index])) {
    throw new Error("富文本媒体关系与 HTML 不一致");
  }
  if (config.type === "rich_text" && (record.heroSubtitle.trim() || record.banners.length)) {
    throw new Error("单富文本配置不得保留 BANNER 文案或关系");
  }
  if (config.type === "banner_rich_text") {
    if (!record.heroSubtitle.trim()) throw new Error("BANNER 配置缺少宣传语");
    if (record.banners.length < 1 || record.banners.length > 6) throw new Error("BANNER 配置数量应为 1 至 6 张");
  }
}

async function migrateArtists(db: MigrationDb) {
  const artists = await db.artist.findMany({ orderBy: { id: "asc" } });
  for (const artist of artists) {
    try {
      const existing = await db.detailPageConfig.findUnique({
        where: { ownerType_ownerId: { ownerType: "artist", ownerId: artist.id } },
        include: detailPageConfigInclude
      });
      if (existing) {
        validateExistingConfig(existing);
        continue;
      }
      const migrated = await migrateLegacyHtml(db, artist.detail);
      const media = migrated.html ? extractRichTextMedia(migrated.html) : [];
      await db.detailPageConfig.create({
        data: {
          ownerType: "artist",
          ownerId: artist.id,
          pageType: "rich_text",
          heroSubtitle: "",
          richTextHtml: migrated.html,
          schemaVersion: 1,
          contentMedia: {
            create: media.map((item) => ({ mediaAssetId: item.assetId }))
          }
        }
      });
    } catch (error) {
      throw new Error(`无法迁移 artist #${artist.id} (${artist.name}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function migrateCases(db: MigrationDb) {
  const cases = await db.activityCase.findMany({
    include: { media: { include: { mediaAsset: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    orderBy: { id: "asc" }
  });
  for (const activityCase of cases) {
    try {
      const legacyJson = activityCase.legacyMediaJson.trim();
      if (legacyJson && legacyJson !== "[]") {
        throw new Error(`legacyMediaJson 非空且无法解释: ${legacyJson}`);
      }

      const existing = await db.detailPageConfig.findUnique({
        where: { ownerType_ownerId: { ownerType: "activity_case", ownerId: activityCase.id } },
        include: detailPageConfigInclude
      });
      if (existing) {
        validateExistingConfig(existing);
        await db.activityCaseMedia.deleteMany({ where: { activityCaseId: activityCase.id } });
        continue;
      }

      const oldMediaIds = activityCase.media.map((item) => item.mediaAssetId);
      const initial = await migrateLegacyHtml(db, activityCase.detail, oldMediaIds);
      const existingIds = new Set(initial.html ? extractRichTextMedia(initial.html).map((item) => item.assetId) : []);
      const appended = activityCase.media
        .filter((item) => !existingIds.has(item.mediaAssetId))
        .map((item) =>
          item.mediaAsset.mediaType === "image"
            ? `<img data-media-asset-id="${item.mediaAssetId}" alt="内容图片">`
            : `<video data-media-asset-id="${item.mediaAssetId}"></video>`
        )
        .join("");
      const combined = `${initial.html}${appended}`;
      const assets = await loadAssets(db, [...submittedMediaIds(combined), ...oldMediaIds]);
      const html = combined ? sanitizeAndNormalizeRichText(combined, assets) : "";
      const media = html ? extractRichTextMedia(html) : [];
      await db.detailPageConfig.create({
        data: {
          ownerType: "activity_case",
          ownerId: activityCase.id,
          pageType: "rich_text",
          heroSubtitle: "",
          richTextHtml: html,
          schemaVersion: 1,
          contentMedia: {
            create: media.map((item) => ({ mediaAssetId: item.assetId }))
          }
        }
      });
      await db.activityCaseMedia.deleteMany({ where: { activityCaseId: activityCase.id } });
    } catch (error) {
      throw new Error(
        `无法迁移 activity_case #${activityCase.id} (${activityCase.title}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export async function runDetailPageMigration(prisma: AppPrismaClient) {
  const applied = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    "SELECT id FROM schema_migrations WHERE id = ?",
    DETAIL_PAGE_MIGRATION_ID
  );
  if (applied.length) return;

  await prisma.$transaction(async (db) => {
    const unsupported = await db.activityCase.findMany({
      where: { NOT: { legacyMediaJson: { in: ["", "[]"] } } },
      select: { id: true, title: true, legacyMediaJson: true }
    });
    if (unsupported.length) {
      throw new Error(
        `无法迁移 activity_case: ${unsupported
          .map((item) => `#${item.id} (${item.title}) legacyMediaJson=${item.legacyMediaJson}`)
          .join("; ")}`
      );
    }
    await migrateArtists(db);
    await migrateCases(db);
    await db.$executeRawUnsafe(
      "INSERT INTO schema_migrations (id, appliedAt) VALUES (?, CURRENT_TIMESTAMP)",
      DETAIL_PAGE_MIGRATION_ID
    );
  });
}

export type DetailPageOrphan = {
  id: number;
  ownerType: string;
  ownerId: number;
  reason: string;
};

export async function auditDetailPageOrphans(prisma: AppPrismaClient): Promise<DetailPageOrphan[]> {
  const configs = await prisma.detailPageConfig.findMany({ select: { id: true, ownerType: true, ownerId: true } });
  const artistIds = configs.filter((item) => item.ownerType === "artist").map((item) => item.ownerId);
  const caseIds = configs.filter((item) => item.ownerType === "activity_case").map((item) => item.ownerId);
  const [artists, cases] = await Promise.all([
    artistIds.length ? prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true } }) : [],
    caseIds.length ? prisma.activityCase.findMany({ where: { id: { in: caseIds } }, select: { id: true } }) : []
  ]);
  const existingArtists = new Set(artists.map((item) => item.id));
  const existingCases = new Set(cases.map((item) => item.id));
  return configs.flatMap((config) => {
    const ownerType = config.ownerType as DetailOwnerType | string;
    if (ownerType === "artist" && existingArtists.has(config.ownerId)) return [];
    if (ownerType === "activity_case" && existingCases.has(config.ownerId)) return [];
    return [{
      ...config,
      reason: ownerType === "artist" || ownerType === "activity_case" ? "业务对象不存在" : "未知 ownerType"
    }];
  });
}
