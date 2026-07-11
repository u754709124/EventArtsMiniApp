import { describe, expect, it } from "vitest";
import { resolveAllowedMediaTypes } from "./MediaLibraryModal";
import { mediaAcceptForTypes } from "./MediaUploadAction";
import { validateMediaCandidate } from "./media-file";

const config = {
  image: { mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const, maxBytes: 10 * 1024 * 1024 },
  video: { mimeTypes: ["video/mp4"] as const, maxBytes: 100 * 1024 * 1024 }
};

describe("reusable media selection filters", () => {
  it("keeps field rules as the default and narrows them with an explicit type filter", () => {
    expect(resolveAllowedMediaTypes("detail.richText")).toEqual(["image", "video"]);
    expect(resolveAllowedMediaTypes("detail.richText", ["video"])).toEqual(["video"]);
    expect(resolveAllowedMediaTypes("detail.banner", ["image", "video"])).toEqual(["image"]);
  });

  it("builds upload accept values without changing existing unfiltered behavior", () => {
    expect(mediaAcceptForTypes(["image"])).toBe("image/jpeg,image/png,image/webp");
    expect(mediaAcceptForTypes(["video"])).toBe("video/mp4");
    expect(mediaAcceptForTypes(["image", "video"])).toBe("image/jpeg,image/png,image/webp,video/mp4");
  });

  it("rejects an upload outside the picker type filter before upload", () => {
    expect(
      validateMediaCandidate(
        { mimeType: "video/mp4", size: 1024, mediaType: "video", width: 1280, height: 720 },
        config,
        "detail.richText",
        ["image"]
      )
    ).toBe("当前选择器仅支持图片");
  });
});
