import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./index.scss", import.meta.url), "utf8");

describe("home menu layout", () => {
  it("keeps a stable vertical gap when menu items wrap to another row", () => {
    expect(stylesheet).toMatch(/\.menu-card\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?row-gap:\s*20rpx;/u);
    expect(stylesheet).toMatch(/\.menu-item\s*\{[\s\S]*?width:\s*138rpx;[\s\S]*?gap:\s*10rpx;/u);
  });
});
