import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const tempRoot = path.join(root, ".tmp/artist-detail-slice-test");
const scriptPath = path.join(root, "scripts/slice-artist-detail-assets.ts");
const referencePath = path.join(root, "docs/design/reference-artist-detail-original.png");

type Crop = { left: number; top: number; width: number; height: number };
type PatchAudit = {
  sourceCrop: Crop;
  targetRegion: Crop;
  outputTargetRegion: Crop;
  blend: "over";
  sourceTransform: { type: "mirror-extend"; left: number; top: number; right: number; bottom: number };
  mask: { type: "feather"; left: number; top: number; right: number; bottom: number };
};

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

async function runSlice(options: { sourcePath?: string; copyPath?: string } = {}) {
  const outputDir = path.join(tempRoot, "assets");
  const designDir = path.join(tempRoot, "design");
  const env = {
    ...process.env,
    ARTIST_DETAIL_OUTPUT_DIR: outputDir,
    ARTIST_DETAIL_MANIFEST_PATH: path.join(designDir, "artist-detail-assets.json"),
    ARTIST_DETAIL_GRID_PATH: path.join(designDir, "artist-detail-coordinate-grid.png"),
    ARTIST_DETAIL_CONTACT_SHEET_PATH: path.join(designDir, "artist-detail-assets-contact-sheet.png")
  };
  delete env.ARTIST_DETAIL_REFERENCE_SOURCE;
  delete env.ARTIST_DETAIL_REFERENCE_COPY;
  if (options.sourcePath) env.ARTIST_DETAIL_REFERENCE_SOURCE = options.sourcePath;
  if (options.copyPath) env.ARTIST_DETAIL_REFERENCE_COPY = options.copyPath;
  await execFileAsync(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: root,
    env
  });
  return { outputDir, designDir };
}

async function boundaryDiscontinuity(filename: string, region: Crop) {
  const { data, info } = await sharp(filename).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixelDiff = (first: number, second: number) => {
    let total = 0;
    for (let channel = 0; channel < channels; channel += 1) total += Math.abs(data[first + channel]! - data[second + channel]!);
    return total / channels;
  };
  const vertical = (x: number) => {
    const values: number[] = [];
    for (let y = region.top + 2; y < region.top + region.height - 2; y += 1) {
      values.push(pixelDiff((y * info.width + x - 1) * channels, (y * info.width + x) * channels));
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const horizontal = (y: number) => {
    const values: number[] = [];
    for (let x = region.left + 2; x < region.left + region.width - 2; x += 1) {
      values.push(pixelDiff(((y - 1) * info.width + x) * channels, (y * info.width + x) * channels));
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const ratios: number[] = [];
  if (region.left > 8) {
    const baseline = [-7, -5, -3, 3, 5, 7].map((offset) => vertical(region.left + offset));
    ratios.push(vertical(region.left) / (baseline.reduce((sum, value) => sum + value, 0) / baseline.length));
  }
  if (region.top > 8) {
    const baseline = [-7, -5, -3, 3, 5, 7].map((offset) => horizontal(region.top + offset));
    ratios.push(horizontal(region.top) / (baseline.reduce((sum, value) => sum + value, 0) / baseline.length));
  }
  if (region.left + region.width < info.width - 8) {
    const edge = region.left + region.width;
    const baseline = [-7, -5, -3, 3, 5, 7].map((offset) => vertical(edge + offset));
    ratios.push(vertical(edge) / (baseline.reduce((sum, value) => sum + value, 0) / baseline.length));
  }
  if (region.top + region.height < info.height - 8) {
    const edge = region.top + region.height;
    const baseline = [-7, -5, -3, 3, 5, 7].map((offset) => horizontal(edge + offset));
    ratios.push(horizontal(edge) / (baseline.reduce((sum, value) => sum + value, 0) / baseline.length));
  }
  return Math.max(...ratios);
}

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("artist detail reference slicing", () => {
  it("uses the committed reference by default and produces deterministic, seamless audited assets", async () => {
    expect(await readFile(scriptPath, "utf8")).not.toContain("/private/var/");
    const selfCopy = path.join(tempRoot, "self-copy.png");
    await mkdir(tempRoot, { recursive: true });
    await copyFile(referencePath, selfCopy);
    const { outputDir, designDir } = await runSlice({ copyPath: selfCopy });
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
        patches?: PatchAudit[];
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
    for (const banner of manifest.assets.filter((asset) => asset.kind === "banner")) {
      expect(banner.patches).toHaveLength(1);
      const patch = banner.patches![0]!;
      expect(patch).toMatchObject({
        blend: "over",
        sourceTransform: { type: "mirror-extend", left: expect.any(Number), top: 0, right: 0, bottom: 0 },
        mask: { type: "feather", left: expect.any(Number), top: expect.any(Number), right: expect.any(Number), bottom: expect.any(Number) }
      });
      expect(patch.sourceCrop.width + patch.sourceTransform.left).toBe(patch.targetRegion.width);
      expect(patch.sourceCrop.height).toBeGreaterThanOrEqual(patch.targetRegion.height);
      expect(Math.max(patch.mask.left, patch.mask.top, patch.mask.right, patch.mask.bottom)).toBeGreaterThanOrEqual(16);
      expect(
        await boundaryDiscontinuity(path.join(outputDir, banner.filename), patch.outputTargetRegion),
        `${banner.filename} has a visible patch-edge gradient discontinuity`
      ).toBeLessThanOrEqual(1.75);
    }
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

    await runSlice({ copyPath: selfCopy });
    expect({ assets: await hashFiles(outputDir), design: await hashFiles(designDir) }).toEqual(firstHashes);
  }, 90_000);
});
