// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DetailPageConfigDto } from "@event-arts/shared";
import {
  buildCrudSaveRequest,
  configs,
  prepareCrudEditValues
} from "./main";

const bannerDetailPage: DetailPageConfigDto = {
  type: "banner_rich_text",
  typeLabel: "BANNER + 富文本",
  rendererKey: "bannerRichText",
  schemaVersion: 1,
  heroSubtitle: "专业舞台服务",
  banners: [
    { id: 202, assetId: 22, sortOrder: 1, url: "/uploads/22.png", width: 1420, height: 580 },
    { id: 101, assetId: 11, sortOrder: 0, url: "/uploads/11.png", width: 1420, height: 580 }
  ],
  richTextHtml: '<p>正文<img src="/uploads/33.png" data-media-asset-id="33"></p>',
  blocks: []
};

describe("人员/案例详情页后台接入", () => {
  it("创建人员只提交规范化后的嵌套 detailPage，并保留人员列表字段", () => {
    const request = buildCrudSaveRequest(configs.artists, null, {
      name: "林然",
      type: "host",
      avatarAssetId: 7,
      location: "杭州",
      badge: "十年经验",
      tags: [" 婚礼主持 ", "婚礼主持", "晚宴"],
      summary: "稳定控场",
      sortOrder: 2,
      status: "enabled",
      detail: "不应提交的旧详情",
      detailMediaAssetIds: [98],
      detailPage: {
        type: "rich_text",
        richTextHtml: "<p>人员正文</p>",
        heroSubtitle: "隐藏宣传语",
        bannerAssetIds: [88]
      }
    });

    expect(request.path).toBe("/api/admin/artists");
    expect(request.method).toBe("POST");
    expect(request.body).toEqual({
      name: "林然",
      type: "host",
      avatarAssetId: 7,
      location: "杭州",
      badge: "十年经验",
      tags: ["婚礼主持", "晚宴"],
      summary: "稳定控场",
      sortOrder: 2,
      status: "enabled",
      detailPage: { type: "rich_text", richTextHtml: "<p>人员正文</p>" }
    });
  });

  it("编辑案例保留日期与基础字段，且剔除旧详情和 rich_text 隐藏 BANNER 字段", () => {
    const request = buildCrudSaveRequest(configs.cases, { id: 41 }, {
      title: "年度盛典",
      category: "企业活动",
      tag: "精选",
      coverAssetId: 8,
      summary: "案例简介",
      eventDate: "2026-07-09T00:00:00.000Z",
      location: "上海",
      isFeatured: true,
      featuredSortOrder: 3,
      sortOrder: 4,
      status: "enabled",
      detail: "旧详情",
      detailMediaAssetIds: [1, 2],
      detailPage: {
        type: "banner_rich_text",
        heroSubtitle: "品牌盛典",
        bannerAssetIds: [9, 6],
        richTextHtml: "<p>案例正文</p>",
        staleBannerField: [999]
      }
    });

    expect(request.path).toBe("/api/admin/cases/41");
    expect(request.method).toBe("PUT");
    expect(request.body).toEqual({
      title: "年度盛典",
      category: "企业活动",
      tag: "精选",
      coverAssetId: 8,
      summary: "案例简介",
      eventDate: "2026-07-09T00:00:00.000Z",
      location: "上海",
      isFeatured: true,
      featuredSortOrder: 3,
      sortOrder: 4,
      status: "enabled",
      detailPage: {
        type: "banner_rich_text",
        heroSubtitle: "品牌盛典",
        bannerAssetIds: [9, 6],
        richTextHtml: "<p>案例正文</p>"
      }
    });
  });

  it("编辑时把完整 DTO 的 banners 按 sortOrder 回填为有序媒体 ID", () => {
    const values = prepareCrudEditValues({
      id: 7,
      title: "迁移案例",
      tags: ["舞台"],
      detailPage: bannerDetailPage
    });

    expect(values.detailPage).toEqual({
      type: "banner_rich_text",
      heroSubtitle: "专业舞台服务",
      bannerAssetIds: [11, 22],
      richTextHtml: bannerDetailPage.richTextHtml
    });
  });

  it("旧空记录回填为未选择类型，列表明确显示详情待补充", () => {
    const values = prepareCrudEditValues({ id: 8, name: "待迁移人员", detailPage: null });
    expect(values.detailPage).toBeUndefined();

    const detailTypeColumn = configs.artists.columns.find((column) => "dataIndex" in column && column.dataIndex === "detailPageTypeLabel");
    const rendered = detailTypeColumn && "render" in detailTypeColumn
      ? detailTypeColumn.render?.(null, { detailPageType: null }, 0)
      : null;
    expect(rendered).toBe("详情待补充");
  });
});
