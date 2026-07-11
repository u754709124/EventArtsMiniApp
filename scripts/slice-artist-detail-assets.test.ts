import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const tempRoot = path.join(root, ".tmp/artist-detail-slice-test");
const referencePath =
  "/private/var/folders/c2/2x76090s30vbtc2sg0fyxsj00000gn/T/codex-clipboard-19ddfc0d-299a-4ec2-99b2-a74b1dc36e5d.png";

async function hashFiles(directory: string) {
  const names = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (filename) => [
        path.relative(directory, filename),
        createHash("md5").update(await readFile(filename)).digest("hex")
      ])
    )
  );
}

async function runSlice() {
  const outputDir = path.join(tempRoot, "assets");
  const designDir = path.join(tempRoot, "design");
  await execFileAsync(process.execPath, ["--import", "tsx", path.join(root, "scripts/slice-artist-detail-assets.ts")], {
    cwd: root,
    env: {
      ...process.env,
      ARTIST_DETAIL_REFERENCE_SOURCE: referencePath,
      ARTIST_DETAIL_REFERENCE_COPY: path.join(designDir, "reference-artist-detail-original.png"),
      ARTIST_DETAIL_OUTPUT_DIR: outputDir,
      ARTIST_DETAIL_MANIFEST_PATH: path.join(designDir, "artist-detail-assets.json"),
      ARTIST_DETAIL_GRID_PATH: path.join(designDir, "artist-detail-coordinate-grid.png"),
      ARTIST_DETAIL_CONTACT_SHEET_PATH: path.join(designDir, "artist-detail-assets-contact-sheet.png")
    }
  });
  return { outputDir, designDir };
}

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("artist detail reference slicing", () => {
  it("produces a deterministic audited manifest, coordinate grid, crops and three UI-free banner variants", async () => {
    const { outputDir, designDir } = await runSlice();
    const firstHashes = {
      assets: await hashFiles(outputDir),
      design: await hashFiles(designDir)
    };
    const manifest = JSON.parse(await readFile(path.join(designDir, "artist-detail-assets.json"), "utf8")) as {
      reference: { width: number; height: number; sha256: string };
      assets: Array<{
        filename: string;
        kind: string;
        sourceCrop: { left: number; top: number; width: number; height: number } | null;
        md5: string;
        uiTextExcluded?: boolean;
      }>;
    };

    expect(manifest.reference).toEqual({
      path: "docs/design/reference-artist-detail-original.png",
      width: 898,
      height: 1751,
      sha256: "49f23ba827eb253dec7347672fc49076d6df3ade991624ea7cfef6ded071ff39"
    });
    expect(manifest.assets.filter((asset) => asset.kind === "banner")).toHaveLength(3);
    expect(manifest.assets.filter((asset) => asset.kind === "banner").every((asset) => asset.uiTextExcluded)).toBe(true);
    expect(manifest.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "banner-linran-balanced.png" }),
        expect.objectContaining({ filename: "banner-linran-close.png" }),
        expect.objectContaining({ filename: "banner-linran-wide.png" }),
        expect.objectContaining({ filename: "case-shangri-la-wedding.png" }),
        expect.objectContaining({ filename: "review-wedding.png" }),
        expect.objectContaining({ filename: "icon-calendar.png" }),
        expect.objectContaining({ filename: "detail-case-demo.mp4", kind: "video", sourceCrop: null })
      ])
    );
    for (const asset of manifest.assets) {
      expect(asset.md5).toMatch(/^[a-f0-9]{32}$/);
      if (asset.kind !== "video") expect(asset.sourceCrop).not.toBeNull();
      expect(firstHashes.assets[asset.filename]).toBe(asset.md5);
    }

    await runSlice();
    expect({ assets: await hashFiles(outputDir), design: await hashFiles(designDir) }).toEqual(firstHashes);
  }, 60_000);
});
