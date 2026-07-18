// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { DetailPageConfigDto } from "@event-arts/shared";
import {
  buildCrudSaveRequest,
  configs,
  prepareCrudEditValues
} from "./crud/config";

const bannerDetailPage: DetailPageConfigDto = {
  id: 9,
  name: "专业舞台服务详情",
  type: "banner_rich_text",
  typeLabel: "BANNER + 富文本",
  rendererKey: "bannerRichText",
  schemaVersion: 2,
  hero: {
    title: "专业舞台服务",
    typeLabel: "案例",
    subtitle: "专业舞台服务",
    badge: "",
    tags: [],
    location: "",
    metaItems: []
  },
  heroSubtitle: "专业舞台服务",
  banners: [
    { id: 202, assetId: 22, sortOrder: 1, url: "/uploads/22.png", width: 1420, height: 580 },
    { id: 101, assetId: 11, sortOrder: 0, url: "/uploads/11.png", width: 1420, height: 580 }
  ],
  richTextHtml: '<h1>正文</h1><p>正文</p><img src="/uploads/33.png" data-media-asset-id="33">',
  cards: [{ blocks: [{ type: "richText", html: '<h1>正文</h1><p>正文</p><img src="/uploads/33.png" data-media-asset-id="33">' }] }],
  blocks: []
};

describe("人员/案例详情页后台接入", () => {
  it("编辑菜单时只提交可编辑字段，并清理其他类型残留配置", () => {
    const request = buildCrudSaveRequest(configs["menu-items"], { id: 3 }, {
      id: 3,
      text: "联系我们",
      iconAssetId: 18,
      iconUrl: "/uploads/icon-contact.png",
      type: "contact",
      configJson: {
        phone: "13800001111",
        defaultSort: "newest",
        onlyFeatured: true,
        pageSize: 20
      },
      showOnHome: false,
      sortOrder: 5,
      status: "enabled"
    });

    expect(request.path).toBe("/api/admin/menu-items/3");
    expect(request.method).toBe("PUT");
    expect(request.body).toEqual({
      text: "联系我们",
      iconAssetId: 18,
      type: "contact",
      configJson: { phone: "13800001111" },
      showOnHome: false,
      sortOrder: 5,
      status: "enabled"
    });
  });

  it("活动案例菜单分类为空时保存为未配置筛选", () => {
    const request = buildCrudSaveRequest(configs["menu-items"], { id: 4 }, {
      text: "活动案例",
      iconAssetId: 17,
      type: "activity_case",
      configJson: {
        category: "   ",
        onlyFeatured: false,
        pageSize: 10
      },
      showOnHome: true,
      sortOrder: 4,
      status: "enabled"
    });

    expect(request.body).toEqual({
      text: "活动案例",
      iconAssetId: 17,
      type: "activity_case",
      configJson: { category: undefined, onlyFeatured: false, pageSize: 10 },
      showOnHome: true,
      sortOrder: 4,
      status: "enabled"
    });
  });

  it("活动案例菜单不会持久化文章全部哨兵值", () => {
    const request = buildCrudSaveRequest(configs["menu-items"], { id: 4 }, {
      text: "活动案例",
      iconAssetId: 17,
      type: "activity_case",
      configJson: {
        category: "__ALL_ARTICLES__",
        onlyFeatured: true,
        pageSize: 8
      },
      showOnHome: true,
      sortOrder: 4,
      status: "enabled"
    });

    expect(request.body).toEqual({
      text: "活动案例",
      iconAssetId: 17,
      type: "activity_case",
      configJson: { category: undefined, onlyFeatured: true, pageSize: 8 },
      showOnHome: true,
      sortOrder: 4,
      status: "enabled"
    });
    expect(JSON.stringify(request.body)).not.toContain("__ALL_ARTICLES__");
  });

  it("人员菜单保存为单一 artist 类型，并只提交人员菜单允许的配置", () => {
    const request = buildCrudSaveRequest(configs["menu-items"], { id: 3 }, {
      id: 3,
      text: "人员",
      iconAssetId: 18,
      type: "artist",
      configJson: {
        category: "  ＶＩＰ   主持 ",
        defaultSort: "newest",
        onlyFeatured: true,
        phone: "13800001111",
        pageSize: 12
      },
      showOnHome: true,
      sortOrder: 1,
      status: "enabled"
    });

    expect(request.body).toEqual({
      text: "人员",
      iconAssetId: 18,
      type: "artist",
      configJson: { category: "VIP 主持", defaultSort: "newest", pageSize: 12 },
      showOnHome: true,
      sortOrder: 1,
      status: "enabled"
    });
  });

  it("文章菜单编辑时用友好状态回显全部文章，保存时删除哨兵值", () => {
    const prepared = prepareCrudEditValues({
      id: 6,
      text: "文章",
      iconAssetId: 19,
      type: "article",
      configJson: JSON.stringify({ pageSize: 10 }),
      showOnHome: true,
      sortOrder: 5,
      status: "enabled"
    });
    const preparedConfigJson = prepared.configJson && typeof prepared.configJson === "object" ? prepared.configJson : {};
    const request = buildCrudSaveRequest(configs["menu-items"], { id: 6 }, {
      ...prepared,
      configJson: { ...preparedConfigJson, category: "__ALL_ARTICLES__" }
    });

    expect(prepared.configJson).toMatchObject({ category: "__ALL_ARTICLES__", pageSize: 10 });
    expect(request.body).toEqual({
      text: "文章",
      iconAssetId: 19,
      type: "article",
      configJson: { category: undefined, pageSize: 10 },
      showOnHome: true,
      sortOrder: 5,
      status: "enabled"
    });
    expect(JSON.stringify(request.body)).not.toContain("__ALL_ARTICLES__");
  });

  it("创建人员只提交规范化后的 detailPageId，并保留人员列表字段", () => {
    const request = buildCrudSaveRequest(configs.artists, null, {
      name: "林然",
      type: " ＶＩＰ   主持 ",
      avatarAssetId: 7,
      location: "杭州",
      badge: "十年经验",
      tags: [" 婚礼主持 ", "婚礼主持", "晚宴"],
      summary: "稳定控场",
      detailPageId: null,
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
      type: "VIP 主持",
      avatarAssetId: 7,
      location: "杭州",
      badge: "十年经验",
      tags: ["婚礼主持", "晚宴"],
      summary: "稳定控场",
      detailPageId: null,
      sortOrder: 2,
      status: "enabled"
    });
  });

  it("旧人员分类 slug 回显和保存时映射为中文分类", () => {
    const values = prepareCrudEditValues({ id: 8, name: "待迁移人员", type: "host", avatarAssetId: 7, detailPage: null });
    const request = buildCrudSaveRequest(configs.artists, { id: 8 }, {
      name: "待迁移人员",
      type: values.type,
      avatarAssetId: 7,
      location: "杭州",
      badge: "主持",
      tags: ["主持"],
      summary: "旧分类回显",
      detailPageId: null,
      sortOrder: 1,
      status: "enabled"
    });

    expect(values.type).toBe("主持人");
    expect(request.body).toMatchObject({ type: "主持人" });
  });

  it("编辑案例保留日期与基础字段，且剔除旧详情和嵌套 detailPage", () => {
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
      detailPageId: 55,
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
      detailPageId: 55,
      isFeatured: true,
      featuredSortOrder: 3,
      sortOrder: 4,
      status: "enabled"
    });
  });

  it("编辑时保留 detailPageId，且不把完整 DTO 写回业务表单", () => {
    const values = prepareCrudEditValues({
      id: 7,
      title: "迁移案例",
      tags: ["舞台"],
      detailPageId: 9,
      detailPage: bannerDetailPage
    });

    expect(values.detailPageId).toBe(9);
    expect(values.detailPage).toBe(bannerDetailPage);
  });

  it("旧空记录回填为未选择类型，列表明确显示详情待补充", () => {
    const values = prepareCrudEditValues({ id: 8, name: "待迁移人员", detailPage: null });
    expect(values.detailPageId).toBeNull();
    expect(values.detailPage).toBeNull();

    const detailTypeColumn = configs.artists.columns.find((column) => "dataIndex" in column && column.dataIndex === "detailPageTypeLabel");
    const rendered = detailTypeColumn && "render" in detailTypeColumn
      ? detailTypeColumn.render?.(null, { detailPageType: null }, 0)
      : null;
    expect(rendered).toBe("详情待补充");
  });
});
