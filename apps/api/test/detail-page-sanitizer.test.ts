import { describe, expect, it } from "vitest";
import {
  DetailPageValidationError,
  type DetailPageMediaAsset
} from "../src/detail-pages/detail-page-types";
import {
  extractRichTextMedia,
  sanitizeAndNormalizeRichText
} from "../src/detail-pages/detail-page-sanitizer";
import { buildDetailPageBlocks } from "../src/detail-pages/detail-page-parser";

const assets = new Map<number, DetailPageMediaAsset>([
  [1, { id: 1, mediaType: "image", url: "/uploads/one.webp", width: 1200, height: 800 }],
  [2, { id: 2, mediaType: "video", url: "/uploads/two.mp4", width: 1920, height: 1080 }],
  [3, { id: 3, mediaType: "image", url: "/uploads/three.png", width: 900, height: 600 }]
]);

describe("detail rich-text sanitizer", () => {
  it("removes executable elements, events, unsafe links and unapproved classes", () => {
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

    expect(html).toContain('class="ea-detail-card"');
    expect(html).toContain('class="ea-section-title"');
    expect(html).toContain("color:#333");
    expect(html).not.toMatch(/script|style>|onclick|onmouseover|position|z-index|javascript:|iframe|unknown/);
  });

  it("rejects semantically empty rich text after sanitization", () => {
    for (const html of ["", "   ", "<p><br></p>", "<section><div>　</div></section>", "<script>text</script>"]) {
      expect(() => sanitizeAndNormalizeRichText(html, assets)).toThrowError(DetailPageValidationError);
    }
  });

  it("drops oversized or negative layout styles while preserving reasonable values", () => {
    const html = sanitizeAndNormalizeRichText(
      '<p style="font-size:999px;width:99999px;height:-1px;margin:-20px;max-width:100%;padding:20px">正文</p>',
      assets
    );
    expect(html).toContain("max-width:100%");
    expect(html).toContain("padding:20px");
    expect(html).not.toMatch(/999px|99999px|-1px|-20px/);
  });

  it("rewrites image and video URLs from registered assets and normalizes their attributes", () => {
    const html = sanitizeAndNormalizeRichText(
      `<p>前文</p>
       <img src="https://untrusted.invalid/image.jpg" data-media-asset-id="1" class="bad" onerror="x" alt="现场图">
       <video src="https://untrusted.invalid/video.mp4" data-media-asset-id="2" autoplay loop onclick="x"></video>`,
      assets
    );

    expect(html).toContain(
      '<img src="/uploads/one.webp" data-media-asset-id="1" class="ea-media ea-image" alt="现场图">'
    );
    expect(html).toContain(
      '<video src="/uploads/two.mp4" data-media-asset-id="2" class="ea-media ea-video" controls="" preload="metadata"></video>'
    );
    expect(html).not.toMatch(/untrusted|autoplay|loop|onerror|onclick/);
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
  it("keeps text and images in richText blocks while splitting video in source order", () => {
    const html = sanitizeAndNormalizeRichText(
      `<section class="ea-detail-card"><p>视频之前</p>
       <img data-media-asset-id="1">
       <video data-media-asset-id="2"></video>
       <p>视频之后</p><img data-media-asset-id="3"></section>`,
      assets
    );
    const blocks = buildDetailPageBlocks(html, assets);

    expect(blocks).toHaveLength(3);
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

  it("safely splits a nested legacy video and preserves the adjacent container class", () => {
    const html = sanitizeAndNormalizeRichText(
      `<section class="ea-detail-card"><div class="ea-section-body"><p>甲</p><video data-media-asset-id="2"></video><p>乙</p></div></section>`,
      assets
    );
    const blocks = buildDetailPageBlocks(html, assets);

    expect(blocks.map((block) => block.type)).toEqual(["richText", "video", "richText"]);
    expect(blocks[0]).toHaveProperty("html", expect.stringMatching(/ea-detail-card.*ea-section-body.*甲/s));
    expect(blocks[2]).toHaveProperty("html", expect.stringMatching(/ea-detail-card.*ea-section-body.*乙/s));
  });

  it("converts text-only content into one richText block", () => {
    const html = sanitizeAndNormalizeRichText("<p>纯文本详情</p>", assets);
    expect(buildDetailPageBlocks(html, assets)).toEqual([{ type: "richText", html: "<p>纯文本详情</p>" }]);
  });
});
