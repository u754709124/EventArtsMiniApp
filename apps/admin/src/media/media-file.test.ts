import { describe, expect, it } from "vitest";
import { validateMediaCandidate } from "./media-file";

const config = {
  image: { mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const, maxBytes: 10 * 1024 * 1024 },
  video: { mimeTypes: ["video/mp4"] as const, maxBytes: 100 * 1024 * 1024 }
};

describe("client media validation", () => {
  it("rejects wrong dimensions before a form upload", () => {
    expect(
      validateMediaCandidate(
        { mimeType: "image/png", size: 1024, mediaType: "image", width: 100, height: 100 },
        config,
        "banner.image"
      )
    ).toBe("Banner 图片尺寸必须为 1420x580");
  });

  it("accepts parseable unrestricted video detail media", () => {
    expect(
      validateMediaCandidate(
        { mimeType: "video/mp4", size: 1024, mediaType: "video", width: 1280, height: 720 },
        config,
        "case.detail"
      )
    ).toBeNull();
  });

  it("rejects unsupported formats and oversized files", () => {
    expect(
      validateMediaCandidate(
        { mimeType: "image/gif", size: 1024, mediaType: "image", width: 100, height: 100 },
        config
      )
    ).toContain("JPG、PNG、WebP");
    expect(
      validateMediaCandidate(
        { mimeType: "video/mp4", size: 101 * 1024 * 1024, mediaType: "video", width: 1280, height: 720 },
        config
      )
    ).toContain("100MB");
  });
});
