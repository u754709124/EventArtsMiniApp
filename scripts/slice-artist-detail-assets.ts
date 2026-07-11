import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);

type Crop = { left: number; top: number; width: number; height: number };
type ImageAssetSpec = {
  filename: string;
  kind: "banner" | "case" | "advantage" | "process" | "avatar" | "review" | "icon";
  sourceCrop: Crop;
  output: { width: number; height: number };
  note: string;
  bannerMode?: "balanced" | "close" | "wide";
};
type GeneratedAsset = {
  filename: string;
  kind: ImageAssetSpec["kind"] | "video";
  sourceCrop: Crop | null;
  output: { width: number; height: number };
  md5: string;
  note: string;
  uiTextExcluded?: boolean;
  excludedOverlayRegions?: Crop[];
  patches?: Array<{
    sourceCrop: Crop;
    targetRegion: Crop;
    outputTargetRegion: Crop;
    blend: "over";
    sourceTransform: { type: "mirror-extend"; left: number; top: number; right: number; bottom: number };
    mask: { type: "feather"; left: number; top: number; right: number; bottom: number };
  }>;
};

const root = process.cwd();
const referenceCopy = process.env.ARTIST_DETAIL_REFERENCE_COPY ?? path.join(root, "docs/design/reference-artist-detail-original.png");
const referenceSource = process.env.ARTIST_DETAIL_REFERENCE_SOURCE ?? referenceCopy;
const outputDir = process.env.ARTIST_DETAIL_OUTPUT_DIR ?? path.join(root, "apps/miniapp/src/assets/generated/artist-detail");
const manifestPath = process.env.ARTIST_DETAIL_MANIFEST_PATH ?? path.join(root, "docs/design/artist-detail-assets.json");
const gridPath = process.env.ARTIST_DETAIL_GRID_PATH ?? path.join(root, "docs/design/artist-detail-coordinate-grid.png");
const contactSheetPath = process.env.ARTIST_DETAIL_CONTACT_SHEET_PATH ?? path.join(root, "docs/design/artist-detail-assets-contact-sheet.png");

const expectedReference = {
  width: 898,
  height: 1751,
  sha256: "49f23ba827eb253dec7347672fc49076d6df3ade991624ea7cfef6ded071ff39"
};
const bannerUiRegions: Crop[] = [
  { left: 0, top: 0, width: 520, height: 430 },
  { left: 730, top: 15, width: 148, height: 106 }
];
const curtainPatch = {
  sourceCrop: { left: 760, top: 122, width: 138, height: 170 },
  targetRegion: { left: 680, top: 0, width: 218, height: 170 },
  blend: "over" as const,
  sourceTransform: { type: "mirror-extend" as const, left: 80, top: 0, right: 0, bottom: 0 },
  mask: { type: "feather" as const, left: 55, top: 0, right: 0, bottom: 35 }
};

const imageSpecs: ImageAssetSpec[] = [
  { filename: "banner-linran-balanced.png", kind: "banner", sourceCrop: { left: 0, top: 22, width: 898, height: 367 }, output: { width: 1420, height: 580 }, bannerMode: "balanced", note: "Full host and microphone with rebuilt dark-left focal area." },
  { filename: "banner-linran-close.png", kind: "banner", sourceCrop: { left: 158, top: 42, width: 740, height: 302 }, output: { width: 1420, height: 580 }, bannerMode: "close", note: "Closer right-side host focal crop; head and microphone retained." },
  { filename: "banner-linran-wide.png", kind: "banner", sourceCrop: { left: 0, top: 0, width: 898, height: 430 }, output: { width: 1420, height: 580 }, bannerMode: "wide", note: "Wider activity scene with a deterministic dark extension at left." },
  { filename: "advantage-experience.png", kind: "advantage", sourceCrop: { left: 116, top: 675, width: 54, height: 58 }, output: { width: 120, height: 120 }, note: "Eight-year experience medal icon." },
  { filename: "advantage-scenes.png", kind: "advantage", sourceCrop: { left: 309, top: 676, width: 57, height: 56 }, output: { width: 120, height: 120 }, note: "Wedding and commercial scenes icon." },
  { filename: "advantage-control.png", kind: "advantage", sourceCrop: { left: 527, top: 675, width: 58, height: 58 }, output: { width: 120, height: 120 }, note: "Microphone control icon." },
  { filename: "advantage-mandarin.png", kind: "advantage", sourceCrop: { left: 741, top: 675, width: 56, height: 58 }, output: { width: 120, height: 120 }, note: "Mandarin qualification icon." },
  { filename: "case-shangri-la-wedding.png", kind: "case", sourceCrop: { left: 53, top: 876, width: 150, height: 110 }, output: { width: 600, height: 440 }, note: "Shangri-La wedding scene photo only." },
  { filename: "case-brand-launch.png", kind: "case", sourceCrop: { left: 214, top: 876, width: 151, height: 110 }, output: { width: 604, height: 440 }, note: "Brand launch scene photo only." },
  { filename: "case-annual-gala.png", kind: "case", sourceCrop: { left: 375, top: 876, width: 151, height: 110 }, output: { width: 604, height: 440 }, note: "Annual gala scene photo only." },
  { filename: "case-lawn-wedding.png", kind: "case", sourceCrop: { left: 538, top: 876, width: 151, height: 110 }, output: { width: 604, height: 440 }, note: "Outdoor lawn wedding scene photo only." },
  { filename: "case-appreciation-dinner.png", kind: "case", sourceCrop: { left: 698, top: 876, width: 149, height: 110 }, output: { width: 596, height: 440 }, note: "Appreciation dinner scene photo only." },
  { filename: "process-communication.png", kind: "process", sourceCrop: { left: 93, top: 1127, width: 55, height: 55 }, output: { width: 110, height: 110 }, note: "Requirements communication icon." },
  { filename: "process-plan.png", kind: "process", sourceCrop: { left: 259, top: 1127, width: 55, height: 55 }, output: { width: 110, height: 110 }, note: "Plan confirmation icon." },
  { filename: "process-schedule.png", kind: "process", sourceCrop: { left: 417, top: 1127, width: 55, height: 55 }, output: { width: 110, height: 110 }, note: "Schedule confirmation icon." },
  { filename: "process-execution.png", kind: "process", sourceCrop: { left: 581, top: 1127, width: 55, height: 55 }, output: { width: 110, height: 110 }, note: "On-site execution icon." },
  { filename: "process-followup.png", kind: "process", sourceCrop: { left: 747, top: 1127, width: 55, height: 55 }, output: { width: 110, height: 110 }, note: "After-service follow-up icon." },
  { filename: "customer-xiaoquexing.png", kind: "avatar", sourceCrop: { left: 69, top: 1324, width: 60, height: 60 }, output: { width: 180, height: 180 }, note: "Customer avatar for 小确幸." },
  { filename: "customer-leon.png", kind: "avatar", sourceCrop: { left: 69, top: 1448, width: 60, height: 60 }, output: { width: 180, height: 180 }, note: "Customer avatar for Leon." },
  { filename: "review-wedding.png", kind: "review", sourceCrop: { left: 723, top: 1318, width: 108, height: 105 }, output: { width: 432, height: 420 }, note: "Wedding review image only." },
  { filename: "review-conference.png", kind: "review", sourceCrop: { left: 723, top: 1445, width: 108, height: 108 }, output: { width: 432, height: 432 }, note: "Conference review image only." },
  { filename: "icon-crown.png", kind: "icon", sourceCrop: { left: 217, top: 1328, width: 24, height: 24 }, output: { width: 96, height: 96 }, note: "Customer crown icon." },
  { filename: "icon-location.png", kind: "icon", sourceCrop: { left: 80, top: 387, width: 27, height: 29 }, output: { width: 96, height: 96 }, note: "Location icon." },
  { filename: "icon-calendar.png", kind: "icon", sourceCrop: { left: 55, top: 1588, width: 25, height: 27 }, output: { width: 96, height: 96 }, note: "Schedule reminder calendar icon." },
  { filename: "icon-question.png", kind: "icon", sourceCrop: { left: 469, top: 1588, width: 25, height: 27 }, output: { width: 96, height: 96 }, note: "FAQ question icon." }
];

const demoMp4 = Buffer.from(
  [
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAALwbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAj90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG3bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABYm1p",
    "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAAg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABZQAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALKAAAAAQAAABRzdGNvAAAAAAAAAAEAAAMgAAAAPXVkdGEAAAA1bWV0YQAAAAAAAAAhaGRs",
    "cgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAIaWxzdAAAAAhmcmVlAAAC0m1kYXQAAAKtBgX//6ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJv",
    "bWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAABVliIQAFf/+",
    "7M9+BTcDXsvUEhQgfYE="
  ].join(""),
  "base64"
);

function digest(algorithm: "md5" | "sha256", content: Buffer) {
  return createHash(algorithm).update(content).digest("hex");
}

function inBounds(crop: Crop, width: number, height: number) {
  return crop.left >= 0 && crop.top >= 0 && crop.width > 0 && crop.height > 0 && crop.left + crop.width <= width && crop.top + crop.height <= height;
}

async function cleanedBannerSource() {
  const { width, height } = curtainPatch.targetRegion;
  const base = await sharp(referenceCopy)
    .extract({ left: 0, top: 0, width: 898, height: 430 })
    .removeAlpha()
    .raw()
    .toBuffer();
  const patch = await sharp(referenceCopy)
    .extract(curtainPatch.sourceCrop)
    .extend({ ...curtainPatch.sourceTransform, extendWith: "mirror" })
    .removeAlpha()
    .raw()
    .toBuffer();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftAlpha = curtainPatch.mask.left === 0 ? 1 : Math.min(1, x / curtainPatch.mask.left);
      const bottomDistance = height - 1 - y;
      const bottomAlpha = curtainPatch.mask.bottom === 0 ? 1 : Math.min(1, bottomDistance / curtainPatch.mask.bottom);
      const feather = Math.min(leftAlpha, bottomAlpha);
      const smoothFeather = feather * feather * (3 - 2 * feather);
      const patchOffset = (y * width + x) * 3;
      const baseOffset = ((curtainPatch.targetRegion.top + y) * 898 + curtainPatch.targetRegion.left + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        base[baseOffset + channel] = Math.round(base[baseOffset + channel]! * (1 - smoothFeather) + patch[patchOffset + channel]! * smoothFeather);
      }
    }
  }
  const darkOverlay = Buffer.from(`<svg width="898" height="430" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#170d07" stop-opacity="1"/><stop offset="0.52" stop-color="#24130b" stop-opacity="1"/><stop offset="0.65" stop-color="#2b160c" stop-opacity="0"/></linearGradient></defs><rect width="898" height="430" fill="url(#g)"/></svg>`);
  return sharp(base, { raw: { width: 898, height: 430, channels: 3 } })
    .composite([{ input: darkOverlay, left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

function outputPatchRegion(spec: ImageAssetSpec): Crop {
  if (spec.bannerMode === "wide") {
    const scaleX = 1212 / 898;
    const scaleY = 580 / 430;
    return {
      left: 208 + Math.round(curtainPatch.targetRegion.left * scaleX),
      top: Math.round(curtainPatch.targetRegion.top * scaleY),
      width: Math.round(curtainPatch.targetRegion.width * scaleX),
      height: Math.round(curtainPatch.targetRegion.height * scaleY)
    };
  }
  const intersection = {
    left: Math.max(spec.sourceCrop.left, curtainPatch.targetRegion.left),
    top: Math.max(spec.sourceCrop.top, curtainPatch.targetRegion.top),
    right: Math.min(spec.sourceCrop.left + spec.sourceCrop.width, curtainPatch.targetRegion.left + curtainPatch.targetRegion.width),
    bottom: Math.min(spec.sourceCrop.top + spec.sourceCrop.height, curtainPatch.targetRegion.top + curtainPatch.targetRegion.height)
  };
  const left = Math.round(((intersection.left - spec.sourceCrop.left) / spec.sourceCrop.width) * spec.output.width);
  const top = Math.round(((intersection.top - spec.sourceCrop.top) / spec.sourceCrop.height) * spec.output.height);
  const right = Math.round(((intersection.right - spec.sourceCrop.left) / spec.sourceCrop.width) * spec.output.width);
  const bottom = Math.round(((intersection.bottom - spec.sourceCrop.top) / spec.sourceCrop.height) * spec.output.height);
  return { left, top, width: right - left, height: bottom - top };
}

async function renderImage(spec: ImageAssetSpec, bannerSource: Buffer): Promise<GeneratedAsset> {
  let pipeline: sharp.Sharp;
  if (spec.kind === "banner") {
    const relativeCrop = { ...spec.sourceCrop, top: spec.sourceCrop.top, left: spec.sourceCrop.left };
    if (spec.bannerMode === "wide") {
      const resized = await sharp(bannerSource).resize({ width: 1212, height: 580, fit: "fill" }).toBuffer();
      pipeline = sharp({ create: { width: spec.output.width, height: spec.output.height, channels: 4, background: "#170d07" } }).composite([{ input: resized, left: 208, top: 0 }]);
    } else {
      pipeline = sharp(bannerSource).extract(relativeCrop).resize(spec.output.width, spec.output.height, { fit: "fill" });
    }
  } else {
    pipeline = sharp(referenceCopy).extract(spec.sourceCrop).resize(spec.output.width, spec.output.height, {
      fit: spec.kind === "icon" || spec.kind === "advantage" || spec.kind === "process" ? "contain" : "cover",
      background: { r: 255, g: 252, b: 248, alpha: 1 }
    });
  }
  const outputPath = path.join(outputDir, spec.filename);
  await pipeline.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toFile(outputPath);
  const output = await readFile(outputPath);
  const metadata = await sharp(output).metadata();
  if (metadata.width !== spec.output.width || metadata.height !== spec.output.height) throw new Error(`${spec.filename}: output dimensions are invalid.`);
  return {
    filename: spec.filename,
    kind: spec.kind,
    sourceCrop: spec.sourceCrop,
    output: spec.output,
    md5: digest("md5", output),
    note: spec.note,
    ...(spec.kind === "banner"
      ? {
          uiTextExcluded: true,
          excludedOverlayRegions: bannerUiRegions,
          patches: [{ ...curtainPatch, outputTargetRegion: outputPatchRegion(spec) }]
        }
      : {})
  };
}

async function renderCoordinateGrid() {
  const horizontal = Array.from({ length: 18 }, (_, index) => `<line x1="0" y1="${index * 100}" x2="898" y2="${index * 100}"/><text x="6" y="${index * 100 + 18}">${index * 100}</text>`).join("");
  const vertical = Array.from({ length: 9 }, (_, index) => `<line x1="${index * 100}" y1="0" x2="${index * 100}" y2="1751"/><text x="${index * 100 + 5}" y="40">${index * 100}</text>`).join("");
  const svg = Buffer.from(`<svg width="898" height="1751" xmlns="http://www.w3.org/2000/svg"><g stroke="#00e5ff" stroke-width="1" fill="#00131a" font-family="Arial" font-size="16">${horizontal}${vertical}</g></svg>`);
  await sharp(referenceCopy).composite([{ input: svg }]).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toFile(gridPath);
}

async function renderContactSheet(assets: GeneratedAsset[]) {
  const columns = 4;
  const tile = { width: 300, height: 210 };
  const rows = Math.ceil(assets.length / columns);
  const composites: sharp.OverlayOptions[] = [];
  for (const [index, asset] of assets.entries()) {
    const left = (index % columns) * tile.width;
    const top = Math.floor(index / columns) * tile.height;
    const preview = asset.kind === "video"
      ? await sharp(Buffer.from(`<svg width="276" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="276" height="160" fill="#26150d"/><path d="M118 45l65 35-65 35z" fill="#ed963c"/></svg>`)).png().toBuffer()
      : await sharp(path.join(outputDir, asset.filename)).resize(276, 160, { fit: "contain", background: "#fffaf5" }).png().toBuffer();
    const label = await sharp(Buffer.from(`<svg width="276" height="32" xmlns="http://www.w3.org/2000/svg"><text x="4" y="22" font-family="Arial" font-size="14" fill="#38251b">${asset.filename}</text></svg>`)).png().toBuffer();
    composites.push({ input: preview, left: left + 12, top: top + 10 }, { input: label, left: left + 12, top: top + 170 });
  }
  await sharp({ create: { width: columns * tile.width, height: rows * tile.height, channels: 4, background: "#fffaf5" } })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(contactSheetPath);
}

async function main() {
  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(path.dirname(manifestPath), { recursive: true }), mkdir(path.dirname(referenceCopy), { recursive: true })]);
  const sourceBuffer = await readFile(referenceSource);
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  const sourceReference = { width: sourceMetadata.width ?? 0, height: sourceMetadata.height ?? 0, sha256: digest("sha256", sourceBuffer) };
  if (sourceReference.width !== expectedReference.width || sourceReference.height !== expectedReference.height || sourceReference.sha256 !== expectedReference.sha256) {
    throw new Error(`Unexpected artist detail reference: ${sourceReference.width}x${sourceReference.height} ${sourceReference.sha256}`);
  }
  if (path.resolve(referenceSource) !== path.resolve(referenceCopy)) await copyFile(referenceSource, referenceCopy);
  const referenceBuffer = path.resolve(referenceSource) === path.resolve(referenceCopy) ? sourceBuffer : await readFile(referenceCopy);
  const metadata = await sharp(referenceBuffer).metadata();
  const reference = { width: metadata.width ?? 0, height: metadata.height ?? 0, sha256: digest("sha256", referenceBuffer) };
  if (reference.width !== expectedReference.width || reference.height !== expectedReference.height || reference.sha256 !== expectedReference.sha256) {
    throw new Error(`Unexpected artist detail reference: ${reference.width}x${reference.height} ${reference.sha256}`);
  }
  for (const spec of imageSpecs) if (!inBounds(spec.sourceCrop, reference.width, reference.height)) throw new Error(`${spec.filename}: crop is outside the reference image.`);

  const bannerSource = await cleanedBannerSource();
  const assets: GeneratedAsset[] = [];
  for (const spec of imageSpecs) assets.push(await renderImage(spec, bannerSource));
  const videoPath = path.join(outputDir, "detail-case-demo.mp4");
  await writeFile(videoPath, demoMp4);
  assets.push({ filename: "detail-case-demo.mp4", kind: "video", sourceCrop: null, output: { width: 16, height: 16 }, md5: digest("md5", demoMp4), note: "Deterministic silent H.264 seed clip for video rendering and relationships." });
  await Promise.all([renderCoordinateGrid(), renderContactSheet(assets)]);

  const manifest = {
    reference: { path: "docs/design/reference-artist-detail-original.png", ...reference },
    coordinateGrid: "docs/design/artist-detail-coordinate-grid.png",
    contactSheet: "docs/design/artist-detail-assets-contact-sheet.png",
    outputDir: "apps/miniapp/src/assets/generated/artist-detail",
    assets,
    valid: assets.every((asset) => asset.md5.length === 32)
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Generated ${assets.length} deterministic artist detail assets into ${manifest.outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
