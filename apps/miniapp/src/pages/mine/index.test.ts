import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(import.meta.dirname, "index.tsx"), "utf8");
const pageStyles = readFileSync(resolve(import.meta.dirname, "index.scss"), "utf8");

describe("mine page presentation", () => {
  it("reuses the backend-managed site name and subtitle from the home response", () => {
    expect(pageSource).toContain("const home = await getHome()");
    expect(pageSource).toContain("setSite(home.site)");
    expect(pageSource).toContain("{site.appName}");
    expect(pageSource).toContain("{site.subtitle}");
    expect(pageSource).not.toContain("喜缘主持・演艺服务");
  });

  it("keeps loading and failure recovery consistent with other client pages", () => {
    expect(pageSource).toContain("<LoadingState />");
    expect(pageSource).toContain("<ErrorState onRetry={load} />");
    expect(pageSource).toContain('trackPageView("/pages/mine/index", "mine")');
  });

  it("implements the non-interactive welcome composition without extra feature entries", () => {
    expect(pageSource).toContain('data-testid="mine-welcome"');
    expect(pageSource).toContain("让每一次相聚，都有专业表达");
    expect(pageSource).not.toMatch(/onClick|Button|Navigator/);
    expect(pageStyles).toContain("width: 826rpx");
    expect(pageStyles).toContain("margin-left: -58rpx");
    expect(pageStyles).not.toContain("box-shadow");
    expect(pageStyles).toContain("pointer-events: none");
  });
});
