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
import { createDetailRequestGate } from "./request-race";

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
    sortOrder: 1,
    status: "enabled",
    detailPage: {
      type: "banner_rich_text",
      typeLabel: "BANNER + 富文本",
      rendererKey: "bannerRichText",
      schemaVersion: 1,
      heroSubtitle: "温暖 · 专业 · 掌控全场",
      banners: [],
      richTextHtml: "<p>内容</p>",
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
    isFeatured: true,
    featuredSortOrder: 1,
    sortOrder: 1,
    status: "enabled",
    detailPage: {
      type: "rich_text",
      typeLabel: "单富文本",
      rendererKey: "richText",
      schemaVersion: 1,
      heroSubtitle: "",
      banners: [],
      richTextHtml: "<p>内容</p>",
      blocks: [{ type: "richText", html: "<p>内容</p>" }]
    },
    ...overrides
  };
}

describe("detail renderer registry and layout contracts", () => {
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
});

describe("owner adapters and rich media model", () => {
  it("maps artist fields without leaking the business DTO into the renderer", () => {
    expect(buildArtistHero(artist())).toEqual({
      title: "林然",
      typeLabel: "主持人",
      subtitle: "温暖 · 专业 · 掌控全场",
      badge: "金牌主持",
      tags: ["婚礼主持", "高端晚宴", "控场力强", "普通话一级"],
      location: "杭州"
    });
  });

  it("maps case category/tag, date and location without treating cover as a banner", () => {
    expect(buildCaseHero(activityCase())).toEqual({
      title: "年度品牌盛典",
      typeLabel: "企业活动",
      subtitle: undefined,
      badge: "品牌发布",
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

describe("detail routes forbid removed business actions", () => {
  it("contains no favorite/share/consult/booking/fixed action or residual spacer strings", () => {
    const sources = [
      "pages/artists/detail.tsx",
      "pages/cases/detail.tsx",
      "components/detail-page/DetailPageRenderer.tsx",
      "components/detail-page/detail-page.scss"
    ].map((file) => readFileSync(resolve(miniappSourceRoot, file), "utf8"));
    const forbidden = ["收藏", "分享", "在线咨询", "立即预约", "fixed-action", "action-spacer"];
    forbidden.forEach((text) => expect(sources.join("\n")).not.toContain(text));
  });
});
