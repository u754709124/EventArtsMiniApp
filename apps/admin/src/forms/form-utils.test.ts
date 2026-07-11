import { describe, expect, it } from "vitest";
import {
  millisecondsToSeconds,
  normalizeArtistFormTags,
  normalizeTags,
  omitBusinessDetailFields,
  secondsToMilliseconds,
  statusLabel
} from "./form-utils";

describe("form utilities", () => {
  it("normalizes tags from arrays and JSON strings", () => {
    expect(normalizeTags([" 主持 ", "主持", "晚宴", "", 1], 4)).toEqual(["主持", "晚宴"]);
    expect(normalizeArtistFormTags('["A","a","B","C","D","E"]')).toEqual(["A", "B", "C", "D"]);
  });

  it("converts duration fields between seconds and stored milliseconds", () => {
    expect(millisecondsToSeconds(3500)).toBe(3.5);
    expect(secondsToMilliseconds(1.2)).toBe(1200);
    expect(secondsToMilliseconds("bad", 3000)).toBe(3000);
  });

  it("removes legacy embedded detail payloads and maps status labels", () => {
    expect(omitBusinessDetailFields({ title: "案例", detail: "x", detailMediaAssetIds: [1], detailPage: {}, status: "enabled" })).toEqual({
      title: "案例",
      status: "enabled"
    });
    expect(statusLabel("enabled")).toBe("启用");
    expect(statusLabel("disabled")).toBe("停用");
  });
});
