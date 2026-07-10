import { afterEach, describe, expect, it } from "vitest";
import { getUploadLimits } from "../src/media";

const originalImage = process.env.MAX_IMAGE_UPLOAD_BYTES;
const originalVideo = process.env.MAX_VIDEO_UPLOAD_BYTES;

afterEach(() => {
  if (originalImage === undefined) delete process.env.MAX_IMAGE_UPLOAD_BYTES;
  else process.env.MAX_IMAGE_UPLOAD_BYTES = originalImage;
  if (originalVideo === undefined) delete process.env.MAX_VIDEO_UPLOAD_BYTES;
  else process.env.MAX_VIDEO_UPLOAD_BYTES = originalVideo;
});

describe("media upload limits", () => {
  it("accepts positive integer overrides", () => {
    process.env.MAX_IMAGE_UPLOAD_BYTES = "200000000";
    process.env.MAX_VIDEO_UPLOAD_BYTES = "100000000";
    expect(getUploadLimits()).toEqual({ imageMaxBytes: 200000000, videoMaxBytes: 100000000 });
  });

  it("rejects invalid limit configuration", () => {
    process.env.MAX_IMAGE_UPLOAD_BYTES = "not-a-number";
    expect(() => getUploadLimits()).toThrow(/MAX_IMAGE_UPLOAD_BYTES/);
    process.env.MAX_IMAGE_UPLOAD_BYTES = "0";
    expect(() => getUploadLimits()).toThrow(/MAX_IMAGE_UPLOAD_BYTES/);
  });
});
