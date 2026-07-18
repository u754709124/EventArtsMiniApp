// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailPageConfigDto } from "@event-arts/shared";
import { request } from "../api";
import { DetailPageMobilePreview } from "./DetailPageMobilePreview";
import { DetailPagePreview } from "./DetailPagePreview";

vi.mock("../api", () => ({ request: vi.fn() }));

const previewCss = readFileSync(
  resolve(process.cwd(), "src/detail-pages/detail-page-preview.css"),
  "utf8"
);

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((element: Element) => getComputedStyle(element)) as typeof window.getComputedStyle;
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const bannerDto: DetailPageConfigDto = {
  id: 1,
  name: "预览详情",
  type: "banner_rich_text",
  typeLabel: "BANNER + 富文本",
  rendererKey: "bannerRichText",
  schemaVersion: 2,
  hero: {
    title: "主持人林然",
    typeLabel: "主持人",
    subtitle: "温暖而专业",
    badge: "金牌主持",
    tags: ["10年经验", "婚礼主持", "高端晚宴", "控场力强"],
    location: "杭州",
    metaItems: []
  },
  heroSubtitle: "温暖而专业",
  banners: [{ id: 1, assetId: 11, url: "/uploads/banner.webp", width: 1500, height: 760, sortOrder: 0 }],
  richTextHtml: "<h1>已清洗正文</h1><p>已清洗正文</p><video data-media-asset-id=\"8\"></video>",
  cards: [
    {
      blocks: [
        { type: "richText", html: "<h1>已清洗正文</h1><p>已清洗正文</p>" },
        { type: "video", assetId: 8, url: "/uploads/video.mp4", posterUrl: null, width: 1920, height: 1080 }
      ]
    }
  ],
  blocks: [
    { type: "richText", html: "<h1>已清洗正文</h1><p>已清洗正文</p>" },
    { type: "video", assetId: 8, url: "/uploads/video.mp4", posterUrl: null, width: 1920, height: 1080 }
  ]
};

const longActivityCaseDto: DetailPageConfigDto = {
  ...bannerDto,
  id: 2,
  name: "浪漫粉色系户外婚礼暨品牌答谢晚宴详情",
  hero: {
    title: "浪漫粉色系户外婚礼暨品牌答谢晚宴",
    typeLabel: "企业品牌活动统筹与婚礼主持",
    subtitle: "专业策划・精彩呈现・全流程现场执行",
    badge: "品牌婚礼案例",
    tags: ["户外草坪", "浪漫仪式", "品牌答谢", "现场统筹"],
    location: "杭州・西湖区",
    metaItems: [{ label: "日期", value: "2024-05-18" }]
  }
};

describe("DetailPagePreview", () => {
  it("mirrors flow-based miniapp geometry and rich-text heading semantics at 375px", () => {
    const richHtml = [
      '<h1 style="padding-left:99px">单行标题</h1>',
      "<h1>多行标题<br>第二行</h1>",
      '<p><img src="/uploads/small.webp" width="240" height="160" style="width:900px"></p>'
    ].join("");
    const dtoWithRichHtml = (dto: DetailPageConfigDto): DetailPageConfigDto => ({
      ...dto,
      cards: [{ blocks: [{ type: "richText", html: richHtml }] }],
      blocks: [{ type: "richText", html: richHtml }]
    });
    const { container, rerender } = render(
      <DetailPageMobilePreview dto={dtoWithRichHtml(bannerDto)} />
    );
    const hero = container.querySelector(".detail-preview-hero")!;
    const navigation = container.querySelector(".detail-preview-nav--overlay")!;
    const heroCopy = container.querySelector(".detail-preview-hero-copy")!;
    const headings = [...container.querySelectorAll(".detail-preview-rich-text h1")];
    const markers = [...container.querySelectorAll("[data-detail-heading-marker='true']")];
    const contents = [...container.querySelectorAll("[data-detail-heading-content='true']")];
    const image = container.querySelector(".detail-preview-rich-text img") as HTMLImageElement;

    expect(navigation.parentElement).toBe(hero);
    expect(heroCopy).toBeTruthy();
    expect(previewCss).toMatch(/\.detail-preview-hero\s*\{[^}]*min-height:\s*212px/su);
    expect(previewCss).toMatch(/\.detail-preview-hero\s*\{[^}]*padding:\s*72px 115px 33px 22px/su);
    expect(previewCss).not.toMatch(/\.detail-preview-hero\s*\{[^}]*\n\s*height:\s*212px/su);
    expect(previewCss).toMatch(/\.detail-preview-nav--overlay\s*\{[^}]*height:\s*64px[^}]*padding-top:\s*20px/su);
    expect(previewCss).toMatch(/\.detail-preview-banner\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/su);
    expect(previewCss).toMatch(/\.detail-preview-hero-copy\s*\{[^}]*position:\s*relative/su);
    expect(previewCss).toMatch(/\.detail-preview-rich-text\s*\{[^}]*font-size:\s*15px/su);
    expect(previewCss).toMatch(/\.detail-preview-rich-text h1\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*font-size:\s*17px[^}]*font-weight:\s*700/su);
    expect(headings).toHaveLength(2);
    expect(markers).toHaveLength(2);
    expect(contents).toHaveLength(2);
    headings.forEach((heading) => {
      expect((heading as HTMLElement).style.display).toBe("flex");
      expect((heading as HTMLElement).style.alignItems).toBe("center");
      expect((heading as HTMLElement).style.fontSize).toBe("17px");
      expect((heading as HTMLElement).style.fontWeight).toBe("700");
    });
    markers.forEach((marker) => {
      expect((marker as HTMLElement).style.width).toBe("3px");
      expect((marker as HTMLElement).style.height).toBe("13px");
      expect((marker as HTMLElement).style.maxHeight).toBe("13px");
      expect((marker as HTMLElement).style.marginRight).toBe("5px");
      expect((marker as HTMLElement).style.alignSelf).toBe("center");
      expect((marker as HTMLElement).style.verticalAlign).toBe("");
      expect((marker as HTMLElement).style.marginLeft).toBe("");
    });
    contents.forEach((content) => {
      const style = (content as HTMLElement).style;
      expect(style.flexGrow).toBe("1");
      expect(style.flexShrink).toBe("1");
      expect(style.flexBasis).toBe("0%");
      expect(style.fontSize).toBe("inherit");
    });
    expect(image.style.width).toBe("240px");
    expect(image.style.maxWidth).toBe("100%");
    expect(image.style.height).toBe("auto");

    rerender(<DetailPageMobilePreview dto={dtoWithRichHtml(longActivityCaseDto)} />);
    expect(screen.getByText(longActivityCaseDto.hero.title)).toBeTruthy();
    expect(screen.getByText(longActivityCaseDto.hero.typeLabel)).toBeTruthy();
    expect(screen.getAllByTestId("detail-preview-hero-tag")).toHaveLength(4);
    expect(screen.getByTestId("detail-preview-hero-location").textContent).toBe("杭州・西湖区");
    expect(screen.getByTestId("detail-preview-hero-meta-item").textContent).toBe("日期：2024-05-18");
  });

  it("posts the current unsaved normalized draft and renders the sanitized banner mobile structure", async () => {
    let resolveRequest!: (value: DetailPageConfigDto) => void;
    vi.mocked(request).mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve as (value: DetailPageConfigDto) => void;
    }));
    const getDraft = vi.fn().mockResolvedValue({
      type: "banner_rich_text",
      heroSubtitle: "温暖而专业",
      bannerAssetIds: [11],
      richTextHtml: "<p>未保存正文</p>"
    });
    render(<DetailPagePreview getDraft={getDraft} />);

    fireEvent.click(screen.getByTestId("detail-page-preview"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("正在生成安全预览…")).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/admin/detail-pages/preview", {
      method: "POST",
      body: JSON.stringify({
        detailPage: {
          type: "banner_rich_text",
          heroSubtitle: "温暖而专业",
          bannerAssetIds: [11],
          richTextHtml: "<p>未保存正文</p>"
        }
      })
    }));
    resolveRequest(bannerDto);

    expect(await within(dialog).findByText("主持人林然")).toBeTruthy();
    expect(within(dialog).getByText("温暖而专业")).toBeTruthy();
    expect(within(dialog).getByRole("img", { name: "主持人林然 BANNER 1" })).toBeTruthy();
    expect((within(dialog).getByRole("img", { name: "主持人林然 BANNER 1" }) as HTMLImageElement).className).toContain("is-current");
    expect(dialog.querySelector(".detail-preview-card")).toBeTruthy();
    const video = within(dialog).getByLabelText("详情视频 1") as HTMLVideoElement;
    const videoWrap = video.closest(".detail-preview-video-wrap") as HTMLElement;
    expect(video.poster).toBe("");
    expect(videoWrap.style.maxWidth).toBe("1920px");
    expect(video.style.aspectRatio).toBe("1920 / 1080");
    expect(video.autoplay).toBe(false);
    expect(video.loop).toBe(false);
    expect(video.controls).toBe(true);
    expect(dialog.querySelector("iframe")).toBeNull();
    expect(dialog.querySelector(".detail-preview-first-card-overlap")).toBeTruthy();
  });

  it("renders rich-only DTO with no banner DOM or reserved hero and closing never mutates the draft", async () => {
    const dto: DetailPageConfigDto = {
      ...bannerDto,
      type: "rich_text",
      typeLabel: "单富文本",
      rendererKey: "richText",
      heroSubtitle: "",
      banners: []
    };
    vi.mocked(request).mockResolvedValue(dto);
    const draft = { type: "rich_text" as const, richTextHtml: "<p>未保存</p>" };
    const getDraft = vi.fn().mockResolvedValue(draft);
    render(<DetailPagePreview getDraft={getDraft} />);
    fireEvent.click(screen.getByTestId("detail-page-preview"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findAllByText("已清洗正文")).toHaveLength(2);
    expect(dialog.querySelector(".detail-preview-hero")).toBeNull();
    expect(dialog.querySelector(".detail-preview-first-card-overlap")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭预览" }));
    expect(draft).toEqual({ type: "rich_text", richTextHtml: "<p>未保存</p>" });
    expect(getDraft).toHaveBeenCalledTimes(1);
  });

  it("matches the miniapp empty-content state by not reserving banner DOM", async () => {
    vi.mocked(request).mockResolvedValue({
      ...bannerDto,
      richTextHtml: "<p><br></p>",
      cards: [{ blocks: [{ type: "richText", html: "<p><br></p>" }] }],
      blocks: [{ type: "richText", html: "<p><br></p>" }]
    });
    const getDraft = vi.fn().mockResolvedValue({
      type: "banner_rich_text",
      heroSubtitle: "宣传语",
      bannerAssetIds: [11],
      richTextHtml: "<p><br></p>"
    });
    render(<DetailPagePreview getDraft={getDraft} />);
    fireEvent.click(screen.getByTestId("detail-page-preview"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("详情待补充")).toBeTruthy();
    expect(dialog.querySelector(".detail-preview-hero")).toBeNull();
    expect(dialog.querySelector(".detail-preview-banner")).toBeNull();
    expect(dialog.querySelector(".detail-preview-first-card-overlap")).toBeNull();
  });

  it("shows an actionable error and retries the same current draft", async () => {
    vi.mocked(request)
      .mockRejectedValueOnce(new Error("媒体校验失败"))
      .mockResolvedValueOnce(bannerDto);
    const getDraft = vi.fn().mockResolvedValue({
      type: "banner_rich_text",
      heroSubtitle: "宣传语",
      bannerAssetIds: [11],
      richTextHtml: "<p>正文</p>"
    });
    render(<DetailPagePreview getDraft={getDraft} />);
    fireEvent.click(screen.getByTestId("detail-page-preview"));
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("媒体校验失败");
    fireEvent.click(within(dialog).getByRole("button", { name: "重新生成预览" }));
    expect(await within(dialog).findByText("主持人林然")).toBeTruthy();
    expect(within(dialog).queryByText("重试预览")).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
