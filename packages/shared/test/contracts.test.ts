import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ArtistCreateRequestSchema,
  ArticleCreateRequestSchema,
  ApiErrorCodeSchema,
  DetailPageMenuConfigSchema,
  MenuItemCreateRequestSchema,
  MenuItemUpdateRequestSchema,
  adminChangePasswordRequestSchema,
  adminArticleListQuerySchema,
  adminSessionDtoSchema,
  analyticsFieldLimits,
  artistListQuerySchema,
  artistTypeLabels,
  backupDeleteRequestSchema,
  backupImportPreflightResponseSchema,
  backupManifestSchema,
  backupPreflightSummarySchema,
  backupRestoreAcceptedResponseSchema,
  backupRestoreRequestSchema,
  batchDeleteMediaRequestSchema,
  caseListQuerySchema,
  clientArticleListQuerySchema,
  clientProtectedRouteErrorCodeValues,
  clientWechatLoginErrorCodeValues,
  clientWechatLoginRequestSchema,
  clientWechatLoginResponseSchema,
  edgeOneConfigUpdateRequestSchema,
  fail,
  mediaFieldRules,
  mediaListQuerySchema,
  menuConfigSchemaByType,
  menuTypeValues,
  normalizeArticleCategories,
  normalizeArticleCategory,
  normalizeArtistTags,
  normalizeResourceName,
  ok,
  pageViewRequestSchema,
  rateLimitErrorDataSchema,
  serializeArtistTags,
  strongPasswordSchema,
  updateMediaMetadataSchema,
  type ActivityCaseDetailDto,
  type ActivityCaseListItemDto,
  type ArtistDetailDto,
  type ArtistListItemDto,
  type ClientHomeResponse,
  type DashboardOverviewResponse,
  type EdgeOneConfigResponse,
  type EdgeOneDashboardState,
  type DetailPageConfigDto,
  type DetailPageReferenceDto
} from "../src/index";

describe("shared contracts", () => {
  it("keeps the phase-one menu enum aligned with supported home menu types", () => {
    expect(menuTypeValues).toEqual(["artist", "activity_case", "article", "detail_page", "contact"]);
  });

  it("validates detail-page menu configuration strictly", () => {
    expect(
      DetailPageMenuConfigSchema.parse({ detailPageType: "banner_rich_text", detailPageId: 12 })
    ).toEqual({ detailPageType: "banner_rich_text", detailPageId: 12 });
    expect(menuConfigSchemaByType.detail_page).toBe(DetailPageMenuConfigSchema);
    expect(() => DetailPageMenuConfigSchema.parse({ detailPageId: 12 })).toThrow();
    expect(() => DetailPageMenuConfigSchema.parse({ detailPageType: "unknown", detailPageId: 12 })).toThrow();
    expect(() => DetailPageMenuConfigSchema.parse({ detailPageType: "rich_text", detailPageId: 0 })).toThrow();
    expect(() => DetailPageMenuConfigSchema.parse({ detailPageType: "rich_text", detailPageId: 1.5 })).toThrow();
    expect(() => DetailPageMenuConfigSchema.parse({ detailPageType: "rich_text", detailPageId: 12, extra: true })).toThrow();
  });

  it("supports menu references to detail pages", () => {
    const reference: DetailPageReferenceDto = { sourceType: "menu", sourceId: 7, sourceName: "关于我们" };
    expect(reference).toEqual({ sourceType: "menu", sourceId: 7, sourceName: "关于我们" });
  });

  it("validates menu item create and update requests strictly", () => {
    expect(
      MenuItemCreateRequestSchema.parse({
        text: " 联系我们 ",
        iconAssetId: "5",
        type: "contact",
        configJson: { phone: "13800001111" },
        sortOrder: "2",
        status: "enabled"
      })
    ).toMatchObject({
      text: "联系我们",
      iconAssetId: 5,
      showOnHome: true,
      sortOrder: 2
    });
    expect(MenuItemUpdateRequestSchema.parse({ text: "主持人" })).toEqual({ text: "主持人" });
    expect(() => MenuItemUpdateRequestSchema.parse({ type: "bad" })).toThrow();
    expect(() => MenuItemUpdateRequestSchema.parse({ text: "主持人", iconUrl: "/uploads/icon.png" })).toThrow();
    expect(menuConfigSchemaByType.activity_case.parse({ category: " 婚礼主持 ", onlyFeatured: true, pageSize: 6 }))
      .toEqual({ category: "婚礼主持", onlyFeatured: true, pageSize: 6 });
    expect(menuConfigSchemaByType.activity_case.parse({ category: "   ", onlyFeatured: false, pageSize: 6 }))
      .toEqual({ category: undefined, onlyFeatured: false, pageSize: 6 });
    expect(menuConfigSchemaByType.article.parse({ category: " 婚礼攻略 ", pageSize: 6 }))
      .toEqual({ category: "婚礼攻略", pageSize: 6 });
    expect(menuConfigSchemaByType.article.parse({ category: "   " })).toEqual({ category: undefined, pageSize: 10 });
    expect(() => menuConfigSchemaByType.article.parse({ pageSize: 51 })).toThrow();
    expect(menuConfigSchemaByType.artist.parse({ category: "  主持   人 ", pageSize: 8 }))
      .toEqual({ category: "主持 人", defaultSort: "sortOrder", pageSize: 8 });
    expect(menuConfigSchemaByType.artist.parse({ category: "   " })).toEqual({
      category: undefined,
      defaultSort: "sortOrder",
      pageSize: 10
    });
  });

  it("normalizes and validates article contracts", () => {
    expect(normalizeArticleCategory("  Ｗedding   Guide  ")).toBe("Wedding Guide");
    expect(normalizeArticleCategories([" Guide ", "guide", "婚礼攻略", "婚礼攻略 "])).toEqual(["Guide", "婚礼攻略"]);
    expect(
      ArticleCreateRequestSchema.parse({
        title: " 婚礼攻略 ",
        category: " 婚礼   攻略 ",
        coverAssetId: "3",
        summary: " 摘要 ",
        publishedAt: "2026-07-12T08:00:00.000Z",
        isFeatured: true,
        featuredSortOrder: "1",
        sortOrder: "2",
        status: "enabled",
        detailPageId: null
      })
    ).toMatchObject({
      title: "婚礼攻略",
      category: "婚礼 攻略",
      coverAssetId: 3,
      summary: "摘要",
      isFeatured: true,
      featuredSortOrder: 1,
      sortOrder: 2,
      detailPageId: null
    });
    expect(clientArticleListQuerySchema.parse({ category: " 婚礼攻略 ", pageSize: "50" })).toMatchObject({
      category: "婚礼攻略",
      page: 1,
      pageSize: 50
    });
    expect(adminArticleListQuerySchema.parse({ isFeatured: "true", status: "enabled" })).toMatchObject({
      isFeatured: true,
      status: "enabled"
    });
    expect(() => ArticleCreateRequestSchema.parse({
      title: "文章",
      category: "婚礼攻略",
      coverAssetId: 1,
      summary: "摘要",
      publishedAt: "2026/07/12",
      isFeatured: false,
      featuredSortOrder: 0,
      sortOrder: 0,
      status: "enabled",
      detailPageId: null
    })).toThrow();
    expect(() => ArticleCreateRequestSchema.parse({
      title: "文章",
      category: "",
      coverAssetId: 1,
      summary: "摘要",
      publishedAt: "not-a-date",
      isFeatured: false,
      featuredSortOrder: 0,
      sortOrder: 0,
      status: "enabled",
      detailPageId: null
    })).toThrow();
  });

  it("normalizes resource names for global case-insensitive uniqueness", () => {
    expect(normalizeResourceName("  Ｄｅｍｏ资源  ")).toEqual({
      displayName: "Demo资源",
      key: "demo资源"
    });
  });

  it("defines media requirements per form field instead of upload usage", () => {
    expect(mediaFieldRules["banner.image"]).toMatchObject({
      allowedTypes: ["image"],
      width: 1420,
      height: 580
    });
    expect(mediaFieldRules["menu.icon"]).toMatchObject({ width: 176, height: 176 });
    expect(mediaFieldRules["case.cover"]).toMatchObject({ width: 460, height: 320 });
    expect(mediaFieldRules["article.cover"]).toMatchObject({ allowedTypes: ["image"], width: null, height: null });
    expect(mediaFieldRules["artist.avatar"]).toMatchObject({ width: null, height: null });
    expect(mediaFieldRules["case.detail"]).toMatchObject({ allowedTypes: ["image", "video"] });
  });

  it("validates media list, metadata edit and batch delete inputs", () => {
    expect(mediaListQuerySchema.parse({ page: "2", pageSize: "20", mediaType: "image" })).toMatchObject({
      page: 2,
      pageSize: 20,
      mediaType: "image"
    });
    expect(updateMediaMetadataSchema.parse({ resourceName: " 舞台图 ", tags: [" 婚礼 ", "婚礼", ""] })).toEqual({
      resourceName: "舞台图",
      tags: ["婚礼"]
    });
    expect(batchDeleteMediaRequestSchema.parse({ ids: [3, 3, 4] })).toEqual({ ids: [3, 4] });
  });

  it("wraps success and failure responses in the required envelope", () => {
    expect(ok({ value: 1 })).toEqual({ success: true, data: { value: 1 }, message: "ok" });
    expect(fail("BAD_REQUEST", "参数错误")).toEqual({
      success: false,
      error: { code: "BAD_REQUEST", message: "参数错误" }
    });
    expect(ApiErrorCodeSchema.parse("RATE_LIMITED")).toBe("RATE_LIMITED");
    expect(ApiErrorCodeSchema.parse("SESSION_REVOKED")).toBe("SESSION_REVOKED");
    expect(ApiErrorCodeSchema.parse("BACKUP_INVALID")).toBe("BACKUP_INVALID");
    expect(ApiErrorCodeSchema.parse("INVALID_WECHAT_CODE")).toBe("INVALID_WECHAT_CODE");
    expect(clientWechatLoginErrorCodeValues).toEqual([
      "VALIDATION_ERROR",
      "INVALID_WECHAT_CODE",
      "WECHAT_AUTH_UNAVAILABLE",
      "RATE_LIMITED",
      "INTERNAL_ERROR"
    ]);
    expect(clientProtectedRouteErrorCodeValues).toEqual([
      "CLIENT_AUTH_REQUIRED",
      "CLIENT_SESSION_EXPIRED",
      "CLIENT_SESSION_REVOKED"
    ]);
  });

  it("defines password, session and rate limit security contracts", () => {
    expect(strongPasswordSchema.parse("StrongPass123!")).toBe("StrongPass123!");
    expect(() => strongPasswordSchema.parse("weak-password")).toThrow();
    expect(() => adminChangePasswordRequestSchema.parse({
      currentPassword: "old-password",
      newPassword: "StrongPass123!",
      confirmPassword: "StrongPass123?"
    })).toThrow();
    expect(adminChangePasswordRequestSchema.parse({
      currentPassword: "old-password",
      newPassword: "StrongPass123!",
      confirmPassword: "StrongPass123!"
    })).toMatchObject({ newPassword: "StrongPass123!" });

    expect(adminSessionDtoSchema.parse({
      id: "jti-1",
      adminId: 1,
      username: "admin",
      status: "active",
      createdAt: "2026-07-12T08:00:00.000Z",
      expiresAt: "2026-07-12T10:00:00.000Z",
      revokedAt: null,
      revokeReason: null
    })).toMatchObject({ status: "active" });
    expect(rateLimitErrorDataSchema.parse({ retryAfterSeconds: 60 })).toEqual({ retryAfterSeconds: 60 });
  });

  it("defines the WeChat miniapp login exchange contract without exposing upstream secrets", () => {
    const loginCode = ["temporary", "login", "code"].join("-");
    const sessionToken = Array.from(
      { length: 40 },
      (_, index) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[index % 32]
    ).join("");
    expect(clientWechatLoginRequestSchema.parse({ code: ` ${loginCode} ` })).toEqual({
      code: loginCode
    });
    expect(() => clientWechatLoginRequestSchema.parse({ code: "" })).toThrow();
    expect(() => clientWechatLoginRequestSchema.parse({
      code: "x".repeat(513)
    })).toThrow();
    expect(() => clientWechatLoginRequestSchema.parse({
      code: loginCode,
      session_key: "must-not-be-client-input"
    })).toThrow();

    expect(clientWechatLoginResponseSchema.parse({
      token: sessionToken,
      tokenType: "Bearer",
      expiresInSeconds: 1800,
      expiresAt: "2026-07-12T10:30:00.000Z"
    })).toEqual({
      token: sessionToken,
      tokenType: "Bearer",
      expiresInSeconds: 1800,
      expiresAt: "2026-07-12T10:30:00.000Z"
    });
    expect(() => clientWechatLoginResponseSchema.parse({
      token: "short",
      tokenType: "Bearer",
      expiresInSeconds: 1800,
      expiresAt: "2026-07-12T10:30:00.000Z"
    })).toThrow();
    expect(() => clientWechatLoginResponseSchema.parse({
      token: sessionToken,
      tokenType: "Bearer",
      expiresInSeconds: 1800,
      expiresAt: "2026-07-12T10:30:00.000Z",
      session_key: "must-not-be-returned"
    })).toThrow();
  });

  it("defines analytics field limits without implementing sampling runtime", () => {
    expect(analyticsFieldLimits).toEqual({
      pagePathMaxLength: 256,
      sceneMaxLength: 64,
      userAgentMaxLength: 256
    });
    expect(pageViewRequestSchema.parse({ pagePath: " /pages/index/index ", scene: " home " })).toEqual({
      pagePath: "/pages/index/index",
      scene: "home"
    });
    expect(() => pageViewRequestSchema.parse({ pagePath: "x".repeat(257), scene: "home" })).toThrow();
    expect(() => pageViewRequestSchema.parse({ pagePath: "/pages/index/index", scene: "x".repeat(65) })).toThrow();
  });

  it("defines the dashboard and safe EdgeOne system-config contracts", () => {
    expectTypeOf<DashboardOverviewResponse>().toEqualTypeOf<{
      todayUniqueUsers: number;
      weekDailyUniqueUsers: number;
      monthDailyUniqueUsers: number;
      edgeOne: EdgeOneDashboardState;
    }>();
    expectTypeOf<keyof EdgeOneConfigResponse>().toEqualTypeOf<
      "zoneId" | "secretIdMasked" | "secretIdConfigured" | "secretKeyConfigured" | "updatedAt"
    >();

    expect(edgeOneConfigUpdateRequestSchema.parse({
      zoneId: " zone-example_1 ",
      secretId: "AKID_TEST_VALUE",
      secretKey: "TEST_SECRET_KEY_VALUE"
    })).toEqual({
      zoneId: "zone-example_1",
      secretId: "AKID_TEST_VALUE",
      secretKey: "TEST_SECRET_KEY_VALUE"
    });
    expect(edgeOneConfigUpdateRequestSchema.parse({ zoneId: "zone-example_1" })).toEqual({
      zoneId: "zone-example_1"
    });
    expect(() => edgeOneConfigUpdateRequestSchema.parse({
      zoneId: "zone-example_1",
      secretKey: " secret-with-whitespace "
    })).toThrow();
    expect(() => edgeOneConfigUpdateRequestSchema.parse({
      zoneId: "zone-example_1",
      secretKey: "TEST_SECRET_KEY_VALUE",
      unexpected: true
    })).toThrow();
  });

  it("defines backup manifest and delete/restore confirmation contracts", () => {
    const sha256 = "a".repeat(64);
    const backupManifest = {
      formatVersion: 1,
      status: "ready",
      app: { name: "api", version: "0.1.0" },
      schema: {
        provider: "sqlite",
        sqliteVersion: "3.45.0",
        userVersion: 0,
        schemaHash: sha256,
        migrationIds: ["manual-sqlite-schema"]
      },
      createdBy: { adminId: 1, username: "admin" },
      createdAt: "2026-07-12T08:00:00.000Z",
      note: "手动备份",
      database: {
        path: "database.sqlite",
        size: 1024,
        sha256,
        snapshotMethod: "sqlite-vacuum-into",
        pageSize: 4096,
        pageCount: 1
      },
      uploads: [{ path: "uploads/demo.png", size: 2048, sha256, modifiedAt: "2026-07-12T07:59:00.000Z" }],
      totalBytes: 3072,
      totalFiles: 2,
      sha256
    } as const;
    expect(backupManifestSchema.parse({
      ...backupManifest
    })).toMatchObject({ formatVersion: 1, totalBytes: 3072 });
    expect(backupDeleteRequestSchema.parse({
      backupId: "backup_20260712",
      confirmation: "DELETE_BACKUP"
    })).toEqual({
      backupId: "backup_20260712",
      confirmation: "DELETE_BACKUP"
    });
    expect(() => backupDeleteRequestSchema.parse({
      backupId: "backup_20260712"
    })).toThrow();
    expect(() => backupManifestSchema.parse({
      ...backupManifest,
      database: { ...backupManifest.database, snapshotMethod: "raw-copy" }
    })).toThrow();
    expect(() => backupManifestSchema.parse({
      ...backupManifest,
      uploads: [{ ...backupManifest.uploads[0], path: "/uploads/demo.png" }]
    })).toThrow();
    expect(backupRestoreRequestSchema.parse({
      backupId: "backup_20260712.zip",
      confirmation: "RESTORE_FULL_BACKUP"
    })).toEqual({
      backupId: "backup_20260712.zip",
      confirmation: "RESTORE_FULL_BACKUP"
    });
    const preflight = backupPreflightSummarySchema.parse({
      formatVersion: 1,
      createdAt: backupManifest.createdAt,
      createdBy: backupManifest.createdBy,
      note: backupManifest.note,
      source: "external_archive",
      database: {
        size: backupManifest.database.size,
        snapshotMethod: "sqlite-vacuum-into",
        pageSize: 4096,
        pageCount: 1
      },
      uploads: { fileCount: 1, totalBytes: 2048 },
      totals: { fileCount: 2, totalBytes: 3072 },
      checks: {
        manifest: "ok",
        checksums: "ok",
        sqliteIntegrity: "ok",
        schemaCompatible: true,
        mediaFiles: "ok"
      },
      impact: { tables: [{ table: "media_assets", currentRows: 1, candidateRows: 2, deltaRows: 1 }] }
    });
    expect(backupImportPreflightResponseSchema.parse({
      backup: {
        id: "import_20260712",
        formatVersion: 1,
        status: "ready",
        createdBy: backupManifest.createdBy,
        createdAt: backupManifest.createdAt,
        size: 3072,
        sha256,
        database: { size: 1024, sha256, snapshotMethod: "sqlite-vacuum-into" },
        uploadFileCount: 1,
        note: backupManifest.note
      },
      preflight
    })).toMatchObject({ preflight: { source: "external_archive" } });
    expect(() => backupImportPreflightResponseSchema.parse({
      backup: {
        id: "import_20260712",
        formatVersion: 1,
        status: "ready",
        createdBy: backupManifest.createdBy,
        createdAt: backupManifest.createdAt,
        size: 3072,
        sha256,
        database: { size: 1024, sha256, snapshotMethod: "sqlite-vacuum-into" },
        uploadFileCount: 1,
        note: backupManifest.note
      },
      manifest: backupManifest
    })).toThrow();
    expect(backupRestoreAcceptedResponseSchema.parse({
      restoreId: "restore_20260712",
      backupId: "backup_20260712",
      snapshotBackupId: "backup_20260712_snapshot",
      revokedSessionCount: 2
    })).toMatchObject({ revokedSessionCount: 2 });
    expect(() => backupRestoreRequestSchema.parse({
      backupId: "../backup.zip",
      confirmation: "RESTORE_FULL_BACKUP"
    })).toThrow();
    expect(() => backupManifestSchema.parse({
      ...backupManifest,
      database: { ...backupManifest.database, path: "../database.sqlite" }
    })).toThrow();
  });

  it("types client home response with required top-level fields", () => {
    const home: ClientHomeResponse = {
      site: {
        appName: "喜缘主持",
        subtitle: "专业主持人",
        defaultBannerUrl: "",
        placeholderBannerUrl: "",
        placeholderIconUrl: "",
        placeholderCaseUrl: ""
      },
      announcements: [],
      banners: [],
      menus: [],
      featuredCases: [],
      featuredArticles: []
    };

    expect(Object.keys(home)).toEqual(["site", "announcements", "banners", "menus", "featuredCases", "featuredArticles"]);
  });

  it("separates list summaries from required detail-page DTOs", () => {
    expectTypeOf<ArtistListItemDto>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ActivityCaseListItemDto>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ClientHomeResponse["featuredCases"][number]>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ArtistListItemDto>().toMatchTypeOf<{ detailPageId: number | null; hasDetailPage: boolean }>();
    expectTypeOf<ActivityCaseListItemDto>().toMatchTypeOf<{ detailPageId: number | null; hasDetailPage: boolean }>();
    expectTypeOf<ArtistDetailDto>().toMatchTypeOf<{ detailPage: DetailPageConfigDto | null }>();
    expectTypeOf<ActivityCaseDetailDto>().toMatchTypeOf<{ detailPage: DetailPageConfigDto | null }>();
  });

  it("normalizes artist tags once and keeps legacy slug labels for compatibility", () => {
    expect(artistTypeLabels).toEqual({ host: "主持人", singer: "歌手", actor: "演员" });
    expect(normalizeArtistTags(["  婚礼主持 ", "婚礼主持", "", "高端晚宴"])).toEqual(["婚礼主持", "高端晚宴"]);
    expect(normalizeArtistTags('["婚礼主持", "高端晚宴"]')).toEqual(["婚礼主持", "高端晚宴"]);
    expect(normalizeArtistTags('"[\\"婚礼主持\\"]"')).toEqual([]);
    expect(serializeArtistTags('["婚礼主持", "高端晚宴"]')).toBe('["婚礼主持","高端晚宴"]');
  });

  it("validates the complete artist create payload and normalized client list query", () => {
    expect(
      ArtistCreateRequestSchema.parse({
        name: " 林然 ",
        type: " 主持   人 ",
        avatarAssetId: 12,
        location: " 杭州 ",
        badge: " 金牌主持 ",
        tags: ["10年经验", "婚礼主持"],
        summary: " 风格大气沉稳。 ",
        detailPageId: null,
        sortOrder: 1,
        status: "enabled"
      })
    ).toMatchObject({ name: "林然", type: "主持 人", location: "杭州", badge: "金牌主持", tags: ["10年经验", "婚礼主持"], detailPageId: null });
    expect(
      ArtistCreateRequestSchema.parse({
        name: "旧记录",
        type: "host",
        avatarAssetId: 13,
        location: "杭州",
        badge: "金牌主持",
        tagsJson: '["婚礼主持", "婚礼主持"]',
        summary: "简介",
        detailPageId: 8,
        sortOrder: 1,
        status: "enabled"
      }).tags
    ).toEqual(["婚礼主持"]);
    expect(() => ArtistCreateRequestSchema.parse({
      name: "林然",
      type: "   ",
      avatarAssetId: 14,
      location: "杭州",
      badge: "金牌主持",
      tags: ["婚礼主持"],
      summary: "简介",
      detailPageId: null,
      sortOrder: 1,
      status: "enabled"
    })).toThrow();
    expect(() => ArtistCreateRequestSchema.parse({
      name: "林然",
      type: "很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的人员分类",
      avatarAssetId: 14,
      location: "杭州",
      badge: "金牌主持",
      tags: ["婚礼主持"],
      summary: "简介",
      detailPageId: null,
      sortOrder: 1,
      status: "enabled"
    })).toThrow();
    expect(() => ArtistCreateRequestSchema.parse({
      name: "林然",
      type: "主持人",
      location: "杭州",
      badge: "金牌主持",
      tags: [],
      summary: "简介",
      detailPageId: null,
      sortOrder: 1,
      status: "enabled"
    })).toThrow();
    expect(() => ArtistCreateRequestSchema.parse({
      name: "林然",
      type: "主持人",
      avatarAssetId: 14,
      location: "杭州",
      badge: "金牌主持",
      tags: ["超过十二个字符的标签内容啊"],
      summary: "简介",
      detailPageId: null,
      sortOrder: 1,
      status: "enabled"
    })).toThrow();
    expect(artistListQuerySchema.parse({ q: " 林 ", tag: " 婚礼主持 " })).toEqual({
      q: "林",
      tag: "婚礼主持"
    });
    expect(artistListQuerySchema.parse({ category: " 主持   人 " })).toEqual({ category: "主持 人" });
    expect(artistListQuerySchema.parse({ type: "host" })).toEqual({ category: "主持人" });
    expect(artistListQuerySchema.parse({ type: "host", category: "主持人" })).toEqual({ category: "主持人" });
    expect(caseListQuerySchema.parse({ q: " 年会 ", category: " 歌手演出 " })).toEqual({ q: "年会", category: "歌手演出" });
    expect(caseListQuerySchema.parse({ q: "   ", category: "   " })).toEqual({ q: undefined, category: undefined });
    expect(() => artistListQuerySchema.parse({ type: "host", category: "歌手" })).toThrow();
    expect(() => artistListQuerySchema.parse({ unknown: "invalid" })).toThrow();
  });
});
