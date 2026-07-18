import { describe, expect, it } from "vitest";
import {
  DetailPageValidationError,
  type DetailPageMediaAsset
} from "../src/detail-pages/detail-page-types";
import {
  extractRichTextMedia,
  sanitizeAndNormalizeRichText
} from "../src/detail-pages/detail-page-sanitizer";
import { buildDetailPageBlocks, buildDetailPageCards } from "../src/detail-pages/detail-page-parser";

const assets = new Map<number, DetailPageMediaAsset>([
  [1, { id: 1, mediaType: "image", url: "/uploads/one.webp", width: 1200, height: 800 }],
  [2, { id: 2, mediaType: "video", url: "/uploads/two.mp4", width: 1920, height: 1080 }],
  [3, { id: 3, mediaType: "image", url: "/uploads/three.png", width: 900, height: 600 }],
  [4, { id: 4, mediaType: "image", url: "/uploads/missing-size.webp", width: null, height: null }],
  [5, { id: 5, mediaType: "video", url: "/uploads/vertical.mp4", width: 720, height: 1280 }]
]);

describe("detail rich-text sanitizer", () => {
  it("rewrites legacy sections into canonical H1 cards and removes unsafe markup", () => {
    const html = sanitizeAndNormalizeRichText(
      `<section class="ea-detail-card unknown" onclick="alert(1)">
        <script>alert(1)</script><style>body{display:none}</style>
        <h2 class="ea-section-title">介绍</h2>
        <p style="color:#333;position:fixed;z-index:999999">正文</p>
        <a href="javascript:alert(1)" onmouseover="alert(2)">链接</a>
        <iframe src="https://example.com"></iframe>
      </section>`,
      assets
    );

    expect(html).toContain("<h1>介绍</h1>");
    expect(html).toContain("<p>正文</p>");
    expect(html).not.toMatch(/class=|style=|script|style>|onclick|onmouseover|position|z-index|javascript:|iframe|unknown|h2/);
  });

  it("rejects semantically empty rich text after sanitization", () => {
    for (const html of ["", "   ", "<p><br></p>", "<section><div>　</div></section>", "<script>text</script>"]) {
      expect(() => sanitizeAndNormalizeRichText(html, assets)).toThrowError(DetailPageValidationError);
    }
  });

  it("drops oversized or negative layout styles while preserving reasonable values", () => {
    const html = sanitizeAndNormalizeRichText(
      '<h1>样式</h1><p><span style="font-size:999px;width:99999px;height:-1px;margin:-20px;max-width:100%;padding:20px">正文</span></p>',
      assets
    );
    expect(html).toContain("max-width:100%");
    expect(html).toContain("padding:20px");
    expect(html).not.toMatch(/999px|99999px|-1px|-20px/);
  });

  it("preserves author-entered spaces, text newlines and blank paragraphs", () => {
    const html = sanitizeAndNormalizeRichText(
      "<p>第一  第二</p><p><br></p><p>第三\n\n第四</p>",
      assets
    );

    expect(html).toContain("<p>第一  第二</p>");
    expect(html).toContain("<p><br></p>");
    expect(html).toContain("第三\n\n第四");
  });

  it("preserves editor lists, quotes, dividers and text alignment", () => {
    const html = sanitizeAndNormalizeRichText(
      `<h1 style="text-align: center">格式</h1>
       <p style="text-align: right">右对齐</p>
       <ul><li><p>无序项</p></li></ul>
       <ol><li><p>有序项</p></li></ol>
       <blockquote><p>引用内容</p></blockquote>
       <hr>`,
      assets
    );

    expect(html).toMatch(/<h1 style="text-align:\s*center">格式<\/h1>/);
    expect(html).toMatch(/<p style="text-align:\s*right">右对齐<\/p>/);
    expect(html).toContain("<ul><li><p>无序项</p></li></ul>");
    expect(html).toContain("<ol><li><p>有序项</p></li></ol>");
    expect(html).toContain("<blockquote><p>引用内容</p></blockquote>");
    expect(html).toContain("<hr>");
  });

  it("rewrites image and video URLs from registered assets and normalizes their attributes", () => {
    const html = sanitizeAndNormalizeRichText(
      `<p>前文</p>
       <img src="https://untrusted.invalid/image.jpg" data-media-asset-id="1" class="bad" onerror="x" alt="现场图">
       <video src="https://untrusted.invalid/video.mp4" data-media-asset-id="2" autoplay loop onclick="x"></video>`,
      assets
    );

    expect(html).toContain('<img src="/uploads/one.webp" data-media-asset-id="1" alt="现场图" width="1200" height="800">');
    expect(html).toContain('<video src="/uploads/two.mp4" data-media-asset-id="2" width="1920" height="1080" controls="" preload="metadata"></video>');
    expect(html).not.toMatch(/untrusted|autoplay|loop|onerror|onclick/);
  });

  it("uses trusted asset dimensions over forged input and omits incomplete metadata", () => {
    const html = sanitizeAndNormalizeRichText(
      `<img src="/fake.webp" data-media-asset-id="1" width="20" height="20">
       <img src="/fake-missing.webp" data-media-asset-id="4" width="888" height="777">
       <video src="/fake.mp4" data-media-asset-id="5" width="16" height="9"></video>`,
      assets
    );

    expect(html).toContain('<img src="/uploads/one.webp" data-media-asset-id="1" alt="内容图片" width="1200" height="800">');
    expect(html).toContain('<img src="/uploads/missing-size.webp" data-media-asset-id="4" alt="内容图片">');
    expect(html).toContain('<video src="/uploads/vertical.mp4" data-media-asset-id="5" width="720" height="1280" controls="" preload="metadata"></video>');
    expect(html).not.toMatch(/width="(?:20|888|16)"|height="(?:20|777|9)"/);
  });

  it("rejects dangerous temporary media URLs before rewriting", () => {
    for (const src of ["data:image/png;base64,AA", "blob:https://localhost/id", "file:///tmp/a.png", "/tmp/local.png"]) {
      expect(() =>
        sanitizeAndNormalizeRichText(`<img src="${src}" data-media-asset-id="1">`, assets)
      ).toThrowError(DetailPageValidationError);
    }
  });

  it("rejects missing IDs, missing assets and media type mismatches", () => {
    expect(() => sanitizeAndNormalizeRichText('<img src="/uploads/x.png">', assets)).toThrow(/媒体资源 ID/);
    expect(() =>
      sanitizeAndNormalizeRichText('<img src="/uploads/x.png" data-media-asset-id="99">', assets)
    ).toThrow(/不存在/);
    expect(() =>
      sanitizeAndNormalizeRichText('<img src="/uploads/x.png" data-media-asset-id="2">', assets)
    ).toThrow(/图片节点/);
    expect(() =>
      sanitizeAndNormalizeRichText('<video src="/uploads/x.mp4" data-media-asset-id="1"></video>', assets)
    ).toThrow(/视频节点/);
  });

  it("extracts each canonical content-media relationship once", () => {
    const html = sanitizeAndNormalizeRichText(
      '<img data-media-asset-id="1"><p>中间</p><img data-media-asset-id="1"><video data-media-asset-id="2"></video>',
      assets
    );
    expect(extractRichTextMedia(html)).toEqual([
      { assetId: 1, mediaType: "image" },
      { assetId: 2, mediaType: "video" }
    ]);
  });
});

describe("detail page ordered blocks", () => {
  it("keeps text and images in richText blocks while splitting video in source order inside a card", () => {
    const html = sanitizeAndNormalizeRichText(
      `<section class="ea-detail-card"><p>视频之前</p>
       <img data-media-asset-id="1">
       <video data-media-asset-id="2"></video>
       <p>视频之后</p><img data-media-asset-id="3"></section>`,
      assets
    );
    const blocks = buildDetailPageBlocks(html, assets);
    const cards = buildDetailPageCards(html, assets);

    expect(blocks).toHaveLength(3);
    expect(cards).toHaveLength(1);
    expect(cards[0].blocks).toEqual(blocks);
    expect(blocks[0]).toMatchObject({ type: "richText" });
    expect(blocks[0]).toHaveProperty("html", expect.stringContaining("视频之前"));
    expect(blocks[0]).toHaveProperty("html", expect.stringContaining("/uploads/one.webp"));
    expect(blocks[1]).toEqual({
      type: "video",
      assetId: 2,
      url: "/uploads/two.mp4",
      posterUrl: null,
      width: 1920,
      height: 1080
    });
    expect(blocks[2]).toHaveProperty("html", expect.stringContaining("视频之后"));
    expect(blocks[2]).toHaveProperty("html", expect.stringContaining("/uploads/three.png"));
  });

  it("safely splits a nested legacy video without preserving legacy container classes", () => {
    const html = sanitizeAndNormalizeRichText(
      `<section class="ea-detail-card"><div class="ea-section-body"><p>甲</p><video data-media-asset-id="2"></video><p>乙</p></div></section>`,
      assets
    );
    const blocks = buildDetailPageBlocks(html, assets);

    expect(blocks.map((block) => block.type)).toEqual(["richText", "video", "richText"]);
    expect(blocks[0]).toHaveProperty("html", expect.stringContaining("甲"));
    expect(blocks[0]).not.toHaveProperty("html", expect.stringContaining("<h1>"));
    expect(blocks[0]).not.toHaveProperty("html", expect.stringMatching(/ea-detail-card|ea-section-body/s));
    expect(blocks[2]).toHaveProperty("html", expect.stringContaining("乙"));
  });

  it("converts text-only content into one richText block", () => {
    const html = sanitizeAndNormalizeRichText("<p>纯文本详情</p>", assets);
    expect(buildDetailPageBlocks(html, assets)).toEqual([{ type: "richText", html: "<p>纯文本详情</p>" }]);
  });

  it("does not generate a title for headingless content and preserves explicit titles", () => {
    expect(sanitizeAndNormalizeRichText("<p>正文内容</p>", assets)).toBe("<p>正文内容</p>");
    expect(sanitizeAndNormalizeRichText("<h1>项目介绍</h1><p>正文内容</p>", assets))
      .toBe("<h1>项目介绍</h1><p>正文内容</p>");
  });
});
