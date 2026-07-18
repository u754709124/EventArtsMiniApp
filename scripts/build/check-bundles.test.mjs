import { describe, expect, it } from "vitest";
import { checkBundleBudget, createFixtureDist, formatBudgetReport } from "./check-bundles.mjs";

describe("bundle budget checker", () => {
  it("fails when the output contains no JavaScript assets", () => {
    const fixture = createFixtureDist({
      "index.html": "<div id=\"app\"></div>"
    });
    try {
      const result = checkBundleBudget({
        label: "fixture",
        distDir: fixture.directory,
        maxJsBytes: 10
      });

      expect(result.issues).toEqual([`no JavaScript assets found in ${fixture.directory}`]);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails when a JavaScript asset exceeds the per-file budget", () => {
    const fixture = createFixtureDist({
      "assets/app.js": "x".repeat(12)
    });
    try {
      const result = checkBundleBudget({
        label: "fixture",
        distDir: fixture.directory,
        maxJsBytes: 10
      });

      expect(result.issues).toContain("assets/app.js raw 0.01 KiB exceeds 0.01 KiB");
      expect(formatBudgetReport("fixture", result)).toContain("assets/app.js");
    } finally {
      fixture.cleanup();
    }
  });

  it("uses Vite manifest imports as the static entry closure", () => {
    const manifest = {
      "index.html": {
        file: "assets/index.js",
        isEntry: true,
        imports: ["_framework.js"],
        dynamicImports: ["src/pages/LoginPage.tsx", "src/crud/CrudPage.tsx", "src/detail-pages/DetailPageDesigner.tsx"]
      },
      "_framework.js": {
        file: "assets/framework.js"
      },
      "src/pages/LoginPage.tsx": {
        file: "assets/LoginPage.js"
      },
      "src/crud/CrudPage.tsx": {
        file: "assets/CrudPage.js"
      },
      "src/detail-pages/DetailPageDesigner.tsx": {
        file: "assets/DetailPageDesigner.js"
      },
      "_antd.js": {
        file: "assets/antd.js"
      }
    };
    const fixture = createFixtureDist({
      ".vite/manifest.json": JSON.stringify(manifest),
      "assets/index.js": "a".repeat(20),
      "assets/framework.js": "b".repeat(20),
      "assets/LoginPage.js": "c".repeat(1000),
      "assets/CrudPage.js": "d".repeat(1000),
      "assets/DetailPageDesigner.js": "e".repeat(1000),
      "assets/antd.js": "f".repeat(20)
    });
    try {
      const result = checkBundleBudget({
        label: "fixture",
        distDir: fixture.directory,
        maxJsBytes: 2000,
        adminManifest: {
          path: ".vite/manifest.json",
          maxEntryGzipBytes: 200,
          requiredDynamicEntries: [
            { name: "login", pattern: /LoginPage/ },
            { name: "crud", pattern: /CrudPage/ },
            { name: "detail-editor", pattern: /DetailPageDesigner/ }
          ],
          requiredChunkNames: [/framework/, /antd/]
        }
      });

      expect(result.entry.entryFiles).toEqual(["assets/framework.js", "assets/index.js"]);
      expect(result.issues).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it("fails H5 entrypoint raw budget from index.html script tags", () => {
    const fixture = createFixtureDist({
      "index.html": '<div id="app"></div><script src="/js/runtime.js"></script><script src="/js/app.js"></script>',
      "js/runtime.js": "r".repeat(4),
      "js/app.js": "a".repeat(12)
    });
    try {
      const result = checkBundleBudget({
        label: "fixture",
        distDir: fixture.directory,
        maxJsBytes: 100,
        h5Entrypoint: {
          html: "index.html",
          maxEntryRawBytes: 10
        }
      });

      expect(result.entry.entryFiles).toEqual(["js/app.js", "js/runtime.js"]);
      expect(result.issues).toContain("H5 html entry raw 0.02 KiB exceeds 0.01 KiB");
    } finally {
      fixture.cleanup();
    }
  });
});
