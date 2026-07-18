import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "index.tsx"), "utf8");

describe("home banner pull-refresh recovery", () => {
  it("remounts configured banner images only after a successful background refresh", () => {
    expect(source).toContain("const [bannerMediaRefreshVersion, setBannerMediaRefreshVersion] = useState(0)");
    expect(source).toContain("if (background) setBannerMediaRefreshVersion((version) => version + 1)");
    expect(source).toContain("mediaRefreshVersion={bannerMediaRefreshVersion}");
    expect(source).toContain("key={hasConfiguredBanners ? `${banner.id}:${mediaRefreshVersion}` : banner.id}");
  });

  it("keeps image failures visible until the next successful refresh remounts the images", () => {
    expect(source).toContain("const [failedBannerIds, setFailedBannerIds] = useState<Set<number>>(() => new Set())");
    expect(source).toContain("useEffect(() => {\n    setFailedBannerIds(new Set());\n  }, [mediaRefreshVersion])");
    expect(source).toContain("onError={() => markBannerFailed(banner.id)}");
    expect(source).toContain('data-testid="home-banner-failure"');
    expect(source).toContain("图片加载失败，请下拉刷新");
  });

  it("does not expose click-based reload controls on the home failure surfaces", () => {
    expect(source).not.toContain("重新加载图片");
    expect(source).not.toContain("home-reload");
    expect(source).not.toContain("onRetry");
  });
});
