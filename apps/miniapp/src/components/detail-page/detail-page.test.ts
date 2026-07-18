import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detailPageTypeDefinitions,
  type ActivityCaseDetailDto,
  type ArtistDetailDto
} from "@event-arts/shared";
import { buildArtistHero, buildCaseHero } from "./adapters";
import {
  collectDetailImageUrls,
  getDetailLayoutContract,
  getRendererRegistration,
  hasSemanticDetailContent,
  sortDetailBanners
} from "./model";
import {
  previewRichTextImage,
  resolveRichTextImageTarget,
  updateFailedMediaIds
} from "./media-health";
import { createDetailRequestGate } from "./request-race";
import {
  buildDetailSharePath,
  buildDetailShareState,
  normalizeDetailShareId,
  resolveDetailShareImage,
  resolveDetailShareTitle
} from "./detail-share";
import { getVideoAspectRatioPadding } from "./video-layout";
import {
  detailBannerMinHeightRpx,
  detailCardOverlapRpx,
  detailHeroBottomSpaceRpx,
  detailHeroVisibleGapRpx,
  getDetailHeroTop,
  detailNavigationFallbackMetrics
} from "./navigation-layout";
import { enhanceDetailRichTextForDisplay } from "./rich-text-display";

const miniappSourceRoot = resolve(import.meta.dirname, "../..");

function artist(overrides: Partial<ArtistDetailDto> = {}): ArtistDetailDto {
  return {
    id: 1,
    name: "林然",
    type: "host",
    coverUrl: null,
    avatarUrl: null,
    location: "杭州",
    badge: "金牌主持",
    tags: ["婚礼主持", "高端晚宴", "控场力强", "普通话一级", "不应展示"],
    summary: "摘要",
    detail: "",
    detailPageId: 101,
    hasDetailPage: true,
    sortOrder: 1,
    status: "enabled",
    detailPage: {
      id: 101,
      name: "林然详情",
      type: "banner_rich_text",
      typeLabel: "BANNER + 富文本",
      rendererKey: "bannerRichText",
      schemaVersion: 2,
      hero: {
        title: "林然",
        typeLabel: "主持人",
        subtitle: "温暖 · 专业 · 掌控全场",
        badge: "金牌主持",
        tags: ["婚礼主持", "高端晚宴"],
        location: "杭州",
        metaItems: []
      },
      heroSubtitle: "温暖 · 专业 · 掌控全场",
      banners: [],
      richTextHtml: "<p>内容</p>",
      cards: [{ blocks: [{ type: "richText", html: "<h1>内容</h1><p>内容</p>" }] }],
      blocks: [{ type: "richText", html: "<p>内容</p>" }]
    },
    ...overrides
  };
}

function activityCase(overrides: Partial<ActivityCaseDetailDto> = {}): ActivityCaseDetailDto {
  return {
    id: 2,
    title: "年度品牌盛典",
    category: "企业活动",
    tag: "品牌发布",
    coverUrl: "/cover-that-is-not-a-banner.jpg",
    summary: "摘要",
    eventDate: "2026-07-11",
    location: "上海",
    detail: "",
    media: [],
    detailPageId: 201,
    hasDetailPage: true,
    isFeatured: true,
    featuredSortOrder: 1,
    sortOrder: 1,
    status: "enabled",
    detailPage: {
      id: 201,
      name: "年度品牌盛典详情",
      type: "rich_text",
      typeLabel: "单富文本",
      rendererKey: "richText",
      schemaVersion: 2,
      hero: {
        title: "",
        typeLabel: "",
        subtitle: "",
        badge: "",
        tags: [],
        location: "",
        metaItems: []
      },
      heroSubtitle: "",
      banners: [],
      richTextHtml: "<p>内容</p>",
      cards: [{ blocks: [{ type: "richText", html: "<h1>内容</h1><p>内容</p>" }] }],
      blocks: [{ type: "richText", html: "<p>内容</p>" }]
    },
    ...overrides
  };
}

describe("detail renderer registry and layout contracts", () => {
  it("keeps a minimum BANNER while reserving collision-safe flow space around Hero", () => {
    expect(detailBannerMinHeightRpx).toBe(424);
    expect(detailHeroVisibleGapRpx).toBeGreaterThan(0);
    expect(detailHeroBottomSpaceRpx).toBe(detailCardOverlapRpx + detailHeroVisibleGapRpx);
    expect(detailHeroBottomSpaceRpx).toBeGreaterThan(detailCardOverlapRpx);
    expect(getDetailHeroTop(detailNavigationFallbackMetrics)).toBe(72);
    expect(getDetailHeroTop({ safeTop: 47, headerHeight: 52 })).toBe(107);
  });

  it("registers every shared renderer key exactly once and rejects unknown keys", () => {
    const expectedKeys = Object.values(detailPageTypeDefinitions)
      .map((definition) => definition.rendererKey)
      .sort();
    expect(getRendererRegistration().sort()).toEqual(expectedKeys);
    expect(() => getDetailLayoutContract("futureRenderer" as never)).toThrow("未知详情页渲染器");
  });

  it("keeps rich-only structurally free of every banner and overlap node", () => {
    expect(getDetailLayoutContract("richText")).toEqual({
      createsBanner: false,
      createsHero: false,
      createsCounter: false,
      createsBannerSkeleton: false,
      reservesBannerHeight: false,
      usesNegativeOverlap: false
    });
    expect(getDetailLayoutContract("bannerRichText")).toMatchObject({
      createsBanner: true,
      createsHero: true,
      createsCounter: true,
      createsBannerSkeleton: true,
      reservesBannerHeight: true,
      usesNegativeOverlap: true
    });
    const richOnlySource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/RichTextRenderer.tsx"),
      "utf8"
    );
    ["Swiper", "DetailHeroBanner", "detail-banner", "counter", "skeleton", "overlap"].forEach(
      (token) => {
        expect(richOnlySource).not.toContain(token);
      }
    );
  });

  it("uses a banner-free neutral skeleton before every route knows its renderer", () => {
    const routeViewSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/DetailRouteView.tsx"),
      "utf8"
    );
    const skeletonSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/DetailPageSkeleton.tsx"),
      "utf8"
    );
    const routeSources = ["pages/artists/detail.tsx", "pages/cases/detail.tsx"].map((file) =>
      readFileSync(resolve(miniappSourceRoot, file), "utf8")
    );
    expect(routeViewSource).toContain('loadingLayout = "richText"');
    expect(routeSources.join("\n")).not.toContain('loadingLayout="bannerRichText"');
    expect(skeletonSource).toContain('const banner = layout === "bannerRichText"');
    expect(getDetailLayoutContract("richText").createsBannerSkeleton).toBe(false);
    expect(getDetailLayoutContract("richText").reservesBannerHeight).toBe(false);
    expect(getDetailLayoutContract("richText").usesNegativeOverlap).toBe(false);
  });
});

describe("owner adapters and rich media model", () => {
  it("adds idempotent WeChat-safe centered headings and responsive image styles", () => {
    const source = [
      '<h1 class="title" style="color:#333;padding-left:2rpx;font-size:96px">标题一</h1>',
      "<h1>标题二</h1>",
      "<h1>多行<strong>标题</strong><br><em>第二行</em></h1>",
      '<img data-media-asset-id="9" src="/one.jpg" width="320" height="180" style="width:900px;border:1rpx solid red">',
      '<img data-media-asset-id="10" src="/two.jpg">'
    ].join("");
    const enhanced = enhanceDetailRichTextForDisplay(source);
    const stylesheet = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/detail-page.scss"),
      "utf8"
    );

    expect(enhanced.match(/data-detail-heading-marker="true"/gu)).toHaveLength(3);
    expect(enhanced.match(/data-detail-heading-content="true"/gu)).toHaveLength(3);
    expect(enhanced).toContain('data-detail-rich-text-target="weapp"');
    expect(enhanced).toContain("font-size:15px;line-height:1.72");
    expect(enhanced).not.toMatch(/<\/?h1\b/iu);
    expect(enhanced.match(/display:flex;box-sizing:border-box;align-items:center/gu)).toHaveLength(3);
    expect(enhanced.match(/font-size:17px;font-weight:700;line-height:1\.35/gu)).toHaveLength(3);
    expect(enhanced.match(/width:3px;height:13px;max-height:13px;margin-right:5px/gu)).toHaveLength(3);
    expect(enhanced).toContain("width:320px;max-width:100%;height:auto");
    expect(enhanced).toContain("width:100%;max-width:100%;height:auto");
    expect(enhanced).toContain('class="title"');
    expect(enhanced).toContain("color:#333");
    expect(enhanced).toContain("padding-left:0");
    expect(enhanced).toContain("border-left:0");
    expect(enhanced).toMatch(/多行<strong[^>]*font-size:inherit[^>]*>标题<\/strong><br[^>]*font-size:inherit[^>]*><em[^>]*font-size:inherit[^>]*>第二行<\/em>/u);
    expect(enhanced).toContain("border:1rpx solid red");
    expect(enhanced).toContain('data-media-asset-id="9"');
    expect(enhanced).toContain('width="320"');
    expect(enhanced).toContain('height="180"');
    expect(enhanced).not.toContain("padding-left:2rpx");
    expect(enhanced).not.toContain("font-size:96px");
    expect(enhanced).not.toContain("width:900px");
    expect(enhanced).not.toContain("vertical-align");
    expect(enhanced).not.toContain("margin-left");
    expect(enhanceDetailRichTextForDisplay(enhanced)).toBe(enhanced);
    expect(stylesheet).toContain("$detail-section-title-size: 34rpx");
    expect(stylesheet).toContain("$detail-body-size: 30rpx");
    expect(stylesheet).not.toMatch(/img\s*\{[^}]*width:\s*100%;/u);
    expect(stylesheet).toMatch(/h1\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?font-weight:\s*700;/u);
  });

  it("maps artist fields without leaking the business DTO into the renderer", () => {
    expect(buildArtistHero(artist())).toEqual({
      title: "林然",
      typeLabel: "主持人",
      subtitle: "温暖 · 专业 · 掌控全场",
      badge: "金牌主持",
      tags: ["婚礼主持", "高端晚宴", "控场力强", "普通话一级"],
      location: "杭州",
      metaItems: []
    });
  });

  it("maps case category/tag, date and location without treating cover as a banner", () => {
    expect(buildCaseHero(activityCase())).toEqual({
      title: "年度品牌盛典",
      typeLabel: "企业活动",
      subtitle: "",
      badge: "品牌发布",
      tags: [],
      location: "上海",
      metaItems: [{ label: "日期", value: "2026-07-11" }]
    });
    expect(activityCase().detailPage.banners).toEqual([]);
  });

  it("sorts banners and previews only rich-text images, never video URLs", () => {
    const config = artist().detailPage;
    config.banners = [
      { id: 2, assetId: 2, url: "/b.jpg", width: 100, height: 50, sortOrder: 2 },
      { id: 1, assetId: 1, url: "/a.jpg", width: 100, height: 50, sortOrder: 1 }
    ];
    config.blocks = [
      { type: "richText", html: '<section><img src="/one.jpg"><img src="/two.jpg"></section>' },
      {
        type: "video",
        assetId: 3,
        url: "/never-preview.mp4",
        posterUrl: null,
        width: null,
        height: null
      }
    ];
    expect(sortDetailBanners(config.banners).map((banner) => banner.url)).toEqual([
      "/a.jpg",
      "/b.jpg"
    ]);
    expect(collectDetailImageUrls(config.blocks)).toEqual(["/one.jpg", "/two.jpg"]);
    expect(hasSemanticDetailContent(config.blocks)).toBe(true);
    expect(hasSemanticDetailContent([{ type: "richText", html: "<p><br></p>" }])).toBe(false);
  });
});

describe("detail request race gate", () => {
  it("invalidates the previous ID and aborts its request before accepting the latest", () => {
    const aborted: string[] = [];
    const gate = createDetailRequestGate();
    const first = gate.begin("1", () => aborted.push("1"));
    const second = gate.begin("2", () => aborted.push("2"));
    expect(aborted).toEqual(["1"]);
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.dispose();
    expect(aborted).toEqual(["1", "2"]);
    expect(gate.isCurrent(second)).toBe(false);
  });
});

describe("recoverable detail media", () => {
  it("lets rich-text own slow image loading without an independent failure preflight", () => {
    const richContentSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/DetailRichContent.tsx"),
      "utf8"
    );
    expect(richContentSource).toContain("collectDetailCardImageUrls");
    expect(richContentSource).toContain("previewRichTextImage");
    expect(richContentSource).not.toContain("useDetailImageHealth");
    expect(richContentSource).not.toContain("Taro.getImageInfo");
    expect(richContentSource).not.toContain("detail-rich-image-error");
    expect(richContentSource).not.toContain("正文图片加载失败");
  });

  it("tracks banner failures explicitly and clears them only after media load succeeds", () => {
    expect(updateFailedMediaIds([], 9, true)).toEqual([9]);
    expect(updateFailedMediaIds([9], 9, true)).toEqual([9]);
    expect(updateFailedMediaIds([9, 11], 9, false)).toEqual([11]);
  });

  it("resolves a clicked rich-text image and previews images only", async () => {
    const urls = ["/one.jpg", "/two.jpg"];
    expect(resolveRichTextImageTarget({ target: { dataset: { src: "/two.jpg" } } }, urls)).toBe(
      "/two.jpg"
    );
    expect(resolveRichTextImageTarget({ target: { src: "/video.mp4" } }, urls)).toBeUndefined();

    const calls: Array<{ current: string; urls: string[] }> = [];
    await previewRichTextImage(
      { target: { src: "/one.jpg" } },
      urls,
      async (options) => void calls.push(options)
    );
    expect(calls).toEqual([{ current: "/one.jpg", urls }]);
  });

  it("uses the trusted video ratio exactly and falls back only for invalid dimensions", () => {
    expect(getVideoAspectRatioPadding({ width: 100, height: 300 })).toBe("300%");
    expect(getVideoAspectRatioPadding({ width: 1920, height: 1080 })).toBe("56.25%");
    expect(getVideoAspectRatioPadding({ width: null, height: null })).toBe("56.25%");
    expect(getVideoAspectRatioPadding({ width: 0, height: 1080 })).toBe("56.25%");
    const videoSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/DetailVideoBlock.tsx"),
      "utf8"
    );
    const stylesheet = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/detail-page.scss"),
      "utf8"
    );
    expect(videoSource).toContain('className: "detail-video-wrap detail-video-wrap--intrinsic"');
    expect(videoSource).toContain("maxWidth: `${width}px`");
    expect(videoSource).toContain("aspectRatio: `${width} / ${height}`");
    expect(videoSource).toContain("paddingBottom: getVideoAspectRatioPadding(block)");
    expect(stylesheet).toContain(".detail-video-wrap--intrinsic");
    expect(stylesheet).toMatch(/\.detail-video-wrap--intrinsic\s*\{[\s\S]*?height:\s*auto;[\s\S]*?padding-bottom:\s*0;[\s\S]*?aspect-ratio:\s*16 \/ 9;/u);
  });

  it("wires banner image failures to a visible non-interactive pull-refresh prompt", () => {
    const appImageSource = readFileSync(
      resolve(miniappSourceRoot, "components/AppImage.tsx"),
      "utf8"
    );
    const bannerSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/BannerRichTextRenderer.tsx"),
      "utf8"
    );
    expect(appImageSource).toContain("onError?:");
    expect(appImageSource).toContain("current === src");
    expect(bannerSource).toContain("detail-banner-media-error");
    expect(bannerSource).toContain("请下拉刷新重试");
    expect(bannerSource).not.toContain("bannerRetryKey");
    expect(bannerSource).not.toContain("detail-banner-media-retry");
    expect(bannerSource).not.toContain("重新加载图片");
  });

  it("keeps detail media failures non-interactive so page pull-refresh owns recovery", () => {
    const videoSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/DetailVideoBlock.tsx"),
      "utf8"
    );
    expect(videoSource).toContain("视频加载失败，请下拉刷新重试");
    expect(videoSource).not.toContain("retryKey");
    expect(videoSource).not.toContain("detail:video:retry");
    expect(videoSource).not.toContain("重新加载");
  });
});

describe("detail pull-refresh recovery", () => {
  it("enables native pull-down refresh on standalone and legacy detail pages", () => {
    const configs = [
      "pages/detail/index.config.ts",
      "pages/artists/detail.config.ts",
      "pages/cases/detail.config.ts"
    ].map((file) => readFileSync(resolve(miniappSourceRoot, file), "utf8"));
    configs.forEach((source) => expect(source).toContain("enablePullDownRefresh: true"));
  });

  it("returns awaitable request promises while preserving abort and latest-request gates", () => {
    const resourceSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/useDetailResource.ts"),
      "utf8"
    );
    const legacySource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/LegacyDetailRedirectPage.tsx"),
      "utf8"
    );
    for (const source of [resourceSource, legacySource]) {
      expect(source).toContain("function load(rawId: string | number | undefined, propagateError = false): Promise<void>");
      expect(source).toContain("const token = gate.current.begin");
      expect(source).toContain("task.abort");
      expect(source).toContain("return task.promise");
      expect(source).toContain("if (!gate.current.isCurrent(token)) return");
      expect(source).toContain("if (propagateError) throw error");
      expect(source).toContain("function reload()");
      expect(source).toContain("return load(currentId.current, true)");
    }
  });

  it("removes clickable retry from recoverable detail states while preserving terminal states", () => {
    const routeSource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/DetailRouteView.tsx"),
      "utf8"
    );
    const legacySource = readFileSync(
      resolve(miniappSourceRoot, "components/detail-page/LegacyDetailRedirectPage.tsx"),
      "utf8"
    );
    expect(routeSource).toContain('error: ["页面加载失败", "请下拉刷新重试"]');
    expect(routeSource).toContain('notFound: ["内容不存在或已停用", "请返回列表选择其他内容"]');
    expect(routeSource).toContain('disabled: ["内容已停用", "当前内容暂不可访问"]');
    expect(routeSource).toContain('unknownRenderer: ["详情页类型暂不支持", "请稍后升级后重试"]');
    expect(`${routeSource}\n${legacySource}`).not.toContain("detail-retry");
    expect(`${routeSource}\n${legacySource}`).not.toContain("useRepeatClickGuard");
    expect(`${routeSource}\n${legacySource}`).not.toContain("重新加载");
  });
});

describe("detail page share model", () => {
  it("normalizes only positive integer detail IDs into public detail paths", () => {
    expect(normalizeDetailShareId("101")).toBe(101);
    expect(normalizeDetailShareId(101)).toBe(101);
    expect(normalizeDetailShareId("0")).toBeNull();
    expect(normalizeDetailShareId("1.5")).toBeNull();
    expect(normalizeDetailShareId("abc")).toBeNull();
    expect(buildDetailSharePath("101")).toBe("/pages/detail/index?id=101");
    expect(buildDetailSharePath("abc")).toBeNull();
  });

  it("builds stable share payloads from the current loaded detail only", () => {
    const detailPage = artist().detailPage;
    detailPage.banners = [
      { id: 2, assetId: 12, url: "/uploads/second.png", width: 100, height: 100, sortOrder: 2 },
      { id: 1, assetId: 11, url: "/uploads/first.png", width: 100, height: 100, sortOrder: 1 }
    ];
    const share = buildDetailShareState({
      routeId: "101",
      detailPage,
      hero: { ...detailPage.hero, title: "分享标题" }
    });
    expect(share).toEqual({
      canShare: true,
      payload: {
        title: "分享标题",
        path: "/pages/detail/index?id=101",
        imageUrl: "/uploads/first.png"
      }
    });
    expect(buildDetailShareState({ routeId: "999", detailPage }).canShare).toBe(false);
    expect(buildDetailShareState({ routeId: "abc", detailPage }).canShare).toBe(false);
    expect(buildDetailShareState({ routeId: "101", detailPage: null }).canShare).toBe(false);
  });

  it("falls back to detail names and omits imageUrl when no reliable banner exists", () => {
    const detailPage = activityCase().detailPage;
    expect(resolveDetailShareTitle(detailPage, { ...detailPage.hero, title: "" })).toBe("年度品牌盛典详情");
    expect(resolveDetailShareImage(detailPage)).toBeNull();
    expect(buildDetailShareState({ routeId: 201, detailPage }).payload).toEqual({
      title: "年度品牌盛典详情",
      path: "/pages/detail/index?id=201"
    });
  });
});

describe("detail routes forbid removed business actions", () => {
  it("allows only the floating native share entry and keeps removed business actions banned", () => {
    const sources = [
      "pages/detail/index.tsx",
      "pages/detail/index.config.ts",
      "pages/artists/detail.tsx",
      "pages/cases/detail.tsx",
      "components/detail-page/DetailPageRenderer.tsx",
      "components/detail-page/DetailNavigation.tsx",
      "components/detail-page/detail-share.ts",
      "components/detail-page/detail-page.scss"
    ].map((file) => readFileSync(resolve(miniappSourceRoot, file), "utf8"));
    const joined = sources.join("\n");
    const forbidden = ["收藏", "在线咨询", "立即预约", "fixed-action", "action-spacer"];
    forbidden.forEach((text) => expect(joined).not.toContain(text));
    expect(joined).toContain('openType="share"');
    expect(joined).toContain("useShareAppMessage");
    expect(joined).toContain("enableShareAppMessage: true");
    expect(joined).toContain("/pages/detail/index?id=");
    expect(joined).toContain("detail-share-button");
    expect(joined).not.toContain("detail-navigation__share");
    expect(joined).not.toContain("fixed-bottom");
    expect(joined).not.toContain("business-action");
  });
});
