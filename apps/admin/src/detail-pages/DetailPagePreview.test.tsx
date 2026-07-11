// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailPageConfigDto } from "@event-arts/shared";
import { request } from "../api";
import { DetailPagePreview } from "./DetailPagePreview";

vi.mock("../api", () => ({ request: vi.fn() }));

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
    badge: "",
    tags: [],
    location: "",
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

describe("DetailPagePreview", () => {
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
    expect(video.poster).toBe("");
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
