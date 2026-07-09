import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type Crop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type AssetSpec = {
  filename: string;
  kind: "photo" | "icon" | "placeholder";
  crop?: Crop;
  width: number;
  height: number;
  note: string;
};

type ManifestEntry = {
  filename: string;
  kind: AssetSpec["kind"];
  sourceCrop: Crop | null;
  expected: { width: number; height: number };
  actual: { width: number; height: number };
  valid: boolean;
  note: string;
};

const root = process.cwd();
const referencePath = path.join(root, "docs/design/reference-home.png");
const outputDir = path.join(root, "apps/miniapp/src/assets/generated");
const manifestPath = path.join(root, "docs/design/assets-manifest.json");

const specs: AssetSpec[] = [
  {
    filename: "banner-default.png",
    kind: "photo",
    crop: { left: 22, top: 257, width: 809, height: 334 },
    width: 1420,
    height: 580,
    note: "Main hero banner crop from reference screenshot."
  },
  {
    filename: "placeholder-banner.png",
    kind: "placeholder",
    crop: { left: 22, top: 257, width: 809, height: 334 },
    width: 1420,
    height: 580,
    note: "Blurred warm banner placeholder based on hero colors."
  },
  {
    filename: "icon-host.png",
    kind: "icon",
    crop: { left: 67, top: 632, width: 93, height: 93 },
    width: 176,
    height: 176,
    note: "Host microphone menu icon."
  },
  {
    filename: "icon-singer.png",
    kind: "icon",
    crop: { left: 224, top: 632, width: 93, height: 93 },
    width: 176,
    height: 176,
    note: "Singer music-note menu icon."
  },
  {
    filename: "icon-actor.png",
    kind: "icon",
    crop: { left: 381, top: 632, width: 93, height: 93 },
    width: 176,
    height: 176,
    note: "Actor/acrobatic menu icon."
  },
  {
    filename: "icon-case.png",
    kind: "icon",
    crop: { left: 538, top: 632, width: 93, height: 93 },
    width: 176,
    height: 176,
    note: "Activity case book icon."
  },
  {
    filename: "icon-contact.png",
    kind: "icon",
    crop: { left: 694, top: 790, width: 93, height: 93 },
    width: 176,
    height: 176,
    note: "Contact service headset icon."
  },
  {
    filename: "placeholder-icon.png",
    kind: "placeholder",
    crop: { left: 67, top: 632, width: 93, height: 93 },
    width: 176,
    height: 176,
    note: "Generic warm icon placeholder."
  },
  {
    filename: "case-1.png",
    kind: "photo",
    crop: { left: 24, top: 1010, width: 264, height: 193 },
    width: 460,
    height: 320,
    note: "Wedding hosting case cover."
  },
  {
    filename: "case-2.png",
    kind: "photo",
    crop: { left: 296, top: 1010, width: 264, height: 193 },
    width: 460,
    height: 320,
    note: "Singer performance case cover."
  },
  {
    filename: "case-3.png",
    kind: "photo",
    crop: { left: 569, top: 1010, width: 264, height: 193 },
    width: 460,
    height: 320,
    note: "Acrobatic performance case cover."
  },
  {
    filename: "placeholder-case.png",
    kind: "placeholder",
    crop: { left: 24, top: 1010, width: 264, height: 193 },
    width: 460,
    height: 320,
    note: "Generic warm case placeholder."
  }
];

const warmBackground = { r: 255, g: 248, b: 241, alpha: 1 };

async function renderAsset(spec: AssetSpec): Promise<ManifestEntry> {
  let image = sharp(referencePath);

  if (spec.crop) {
    image = image.extract(spec.crop);
  }

  if (spec.kind === "icon") {
    const iconPadding = 18;
    image = image.resize(spec.width - iconPadding * 2, spec.height - iconPadding * 2, {
      fit: "contain",
      background: warmBackground
    });
    image = image.extend({
      top: iconPadding,
      bottom: iconPadding,
      left: iconPadding,
      right: iconPadding,
      background: warmBackground
    });
  } else {
    image = image.resize(spec.width, spec.height, {
      fit: "cover",
      position: "centre",
      background: warmBackground
    });

    if (spec.kind === "placeholder") {
      image = image.blur(14).modulate({ saturation: 0.35, brightness: 1.08 });
    }
  }

  const outputPath = path.join(outputDir, spec.filename);
  await image.png({ compressionLevel: 9 }).toFile(outputPath);

  const metadata = await sharp(outputPath).metadata();
  const actual = { width: metadata.width ?? 0, height: metadata.height ?? 0 };

  return {
    filename: spec.filename,
    kind: spec.kind,
    sourceCrop: spec.crop ?? null,
    expected: { width: spec.width, height: spec.height },
    actual,
    valid: actual.width === spec.width && actual.height === spec.height,
    note: spec.note
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });

  const referenceMetadata = await sharp(referencePath).metadata();
  const assets: ManifestEntry[] = [];

  for (const spec of specs) {
    assets.push(await renderAsset(spec));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    reference: {
      path: "docs/design/reference-home.png",
      width: referenceMetadata.width ?? 0,
      height: referenceMetadata.height ?? 0
    },
    outputDir: "apps/miniapp/src/assets/generated",
    assets,
    valid: assets.every((asset) => asset.valid)
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (!manifest.valid) {
    throw new Error("Generated asset dimension validation failed.");
  }

  console.log(`Generated ${assets.length} assets into ${manifest.outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
