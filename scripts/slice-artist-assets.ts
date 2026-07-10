import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type Crop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ArtistCoverSpec = {
  filename: string;
  sourceCrop: Crop;
  legacyBadge: Crop;
  repairSource: Crop;
  note: string;
};

type GeneratedCover = ArtistCoverSpec & {
  output: { width: number; height: number };
  sha256: string;
  legacyBadgeExcluded: boolean;
};

const root = process.cwd();
const referencePath = path.join(root, "docs/design/reference-artists.png");
const outputDir = path.join(root, "apps/miniapp/src/assets/generated");
const manifestPath = path.join(root, "docs/design/artist-assets-manifest.json");
const outputSize = { width: 690, height: 480 };

/**
 * The source crops are the photo portions of the reference cards, not the
 * whole cards. A nearby photo-only patch replaces each legacy badge before
 * scaling. The live UI is then free to render its own opaque badge without
 * stacking the screenshot text underneath it.
 */
const covers: ArtistCoverSpec[] = [
  {
    filename: "artist-cover-01.png",
    sourceCrop: { left: 24, top: 251, width: 392, height: 273 },
    legacyBadge: { left: 30, top: 263, width: 120, height: 38 },
    repairSource: { left: 30, top: 303, width: 120, height: 38 },
    note: "林然 reference photo; original 金牌主持 badge is locally repaired."
  },
  {
    filename: "artist-cover-02.png",
    sourceCrop: { left: 430, top: 251, width: 398, height: 273 },
    legacyBadge: { left: 436, top: 263, width: 120, height: 38 },
    repairSource: { left: 436, top: 303, width: 120, height: 38 },
    note: "Jessica reference photo; original 人气主持 badge is locally repaired."
  },
  {
    filename: "artist-cover-03.png",
    sourceCrop: { left: 24, top: 776, width: 392, height: 273 },
    legacyBadge: { left: 30, top: 788, width: 120, height: 38 },
    repairSource: { left: 30, top: 828, width: 120, height: 38 },
    note: "陆安 reference photo; original 实力主持 badge is locally repaired."
  },
  {
    filename: "artist-cover-04.png",
    sourceCrop: { left: 430, top: 776, width: 398, height: 273 },
    legacyBadge: { left: 436, top: 788, width: 120, height: 38 },
    repairSource: { left: 436, top: 828, width: 120, height: 38 },
    note: "沈悦 reference photo; original 高端主持 badge is locally repaired."
  },
  {
    filename: "artist-cover-05.png",
    sourceCrop: { left: 24, top: 1280, width: 354, height: 246 },
    legacyBadge: { left: 30, top: 1292, width: 120, height: 38 },
    repairSource: { left: 30, top: 1332, width: 120, height: 38 },
    note: "Kevin reference photo; original 双语主持 badge is locally repaired."
  },
  {
    filename: "artist-cover-06.png",
    sourceCrop: { left: 430, top: 1280, width: 354, height: 246 },
    legacyBadge: { left: 436, top: 1292, width: 120, height: 38 },
    repairSource: { left: 436, top: 1332, width: 120, height: 38 },
    note: "余薇 reference photo; original 资深主持 badge is locally repaired."
  }
];

function sha256(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function isCropInBounds(crop: Crop, width: number, height: number) {
  return (
    crop.left >= 0 &&
    crop.top >= 0 &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.left + crop.width <= width &&
    crop.top + crop.height <= height
  );
}

function isCropInside(inner: Crop, outer: Crop) {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  );
}

async function renderCover(
  spec: ArtistCoverSpec,
  sourceSize: { width: number; height: number }
): Promise<GeneratedCover> {
  if (!isCropInBounds(spec.sourceCrop, sourceSize.width, sourceSize.height)) {
    throw new Error(`${spec.filename}: crop is outside the reference image.`);
  }

  if (
    !isCropInBounds(spec.legacyBadge, sourceSize.width, sourceSize.height) ||
    !isCropInBounds(spec.repairSource, sourceSize.width, sourceSize.height) ||
    !isCropInside(spec.legacyBadge, spec.sourceCrop)
  ) {
    throw new Error(`${spec.filename}: legacy badge repair bounds are invalid.`);
  }

  const outputPath = path.join(outputDir, spec.filename);
  const scaleX = outputSize.width / spec.sourceCrop.width;
  const scaleY = outputSize.height / spec.sourceCrop.height;
  const repairedBadge = await sharp(referencePath)
    .extract(spec.repairSource)
    .resize(Math.ceil(spec.legacyBadge.width * scaleX), Math.ceil(spec.legacyBadge.height * scaleY), { fit: "fill" })
    .blur(3)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  const photo = await sharp(referencePath).extract(spec.sourceCrop).resize(outputSize.width, outputSize.height, { fit: "fill" }).toBuffer();
  await sharp(photo)
    .composite([
      {
        input: repairedBadge,
        left: Math.floor((spec.legacyBadge.left - spec.sourceCrop.left) * scaleX),
        top: Math.floor((spec.legacyBadge.top - spec.sourceCrop.top) * scaleY)
      }
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toFile(outputPath);

  const [metadata, output] = await Promise.all([
    sharp(outputPath).metadata(),
    readFile(outputPath)
  ]);
  const outputDimensions = {
    width: metadata.width ?? 0,
    height: metadata.height ?? 0
  };

  if (
    outputDimensions.width !== outputSize.width ||
    outputDimensions.height !== outputSize.height
  ) {
    throw new Error(`${spec.filename}: generated output dimensions are invalid.`);
  }

  return {
    ...spec,
    output: outputDimensions,
    sha256: sha256(output),
    legacyBadgeExcluded: true
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });

  const reference = await sharp(referencePath).metadata();
  const referenceSize = {
    width: reference.width ?? 0,
    height: reference.height ?? 0
  };

  if (referenceSize.width !== 853 || referenceSize.height !== 1844) {
    throw new Error(
      `Unexpected reference size: ${referenceSize.width}x${referenceSize.height}; expected 853x1844.`
    );
  }

  const generated = [] as GeneratedCover[];
  for (const cover of covers) {
    generated.push(await renderCover(cover, referenceSize));
  }

  const manifest = {
    reference: {
      path: "docs/design/reference-artists.png",
      width: referenceSize.width,
      height: referenceSize.height,
      sha256: sha256(await readFile(referencePath))
    },
    outputDir: "apps/miniapp/src/assets/generated",
    outputSize,
    covers: generated,
    valid: generated.every(
      (cover) =>
        cover.output.width === outputSize.width &&
        cover.output.height === outputSize.height &&
        cover.legacyBadgeExcluded
    )
  };

  if (!manifest.valid) {
    throw new Error("Artist cover generation validation failed.");
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Generated ${generated.length} artist covers into ${manifest.outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
