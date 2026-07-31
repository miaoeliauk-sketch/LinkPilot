import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const BACKGROUND_PRESETS = ["none", "grid", "xuan-paper"] as const;
export type BackgroundPreset = (typeof BACKGROUND_PRESETS)[number];

export interface ComposeBackgroundOptions {
  inputPath: string;
  outputPath: string;
  preset: BackgroundPreset;
}

export interface ComposeBackgroundResult {
  width: number;
  height: number;
  preset: BackgroundPreset;
}

function backgroundAsset(name: string) {
  return fileURLToPath(
    new URL(`../assets/backgrounds/${name}`, import.meta.url),
  );
}

const BACKGROUND_ASSETS: Record<Exclude<BackgroundPreset, "none">, string> = {
  grid: backgroundAsset("grid-tile.png"),
  "xuan-paper": backgroundAsset("xuan-paper-tile.png"),
};

export async function composeBackground(
  options: ComposeBackgroundOptions,
): Promise<ComposeBackgroundResult> {
  if (resolve(options.inputPath) === resolve(options.outputPath)) {
    throw new Error("输出路径不能覆盖原始透明图");
  }

  const metadata = await sharp(options.inputPath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("无法读取输入图片尺寸");
  }

  const { width, height } = metadata;
  await mkdir(dirname(options.outputPath), { recursive: true });

  if (options.preset === "none") {
    await sharp(options.inputPath).ensureAlpha().png().toFile(options.outputPath);
    return { width, height, preset: options.preset };
  }

  const assetPath = BACKGROUND_ASSETS[options.preset];
  const assetMetadata = await sharp(assetPath).metadata();
  const tile = await sharp(assetPath)
    .resize({
      width: Math.min(width, assetMetadata.width ?? width),
      height: Math.min(height, assetMetadata.height ?? height),
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const background = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 245, g: 240, b: 232, alpha: 1 },
    },
  })
    .composite([
      {
        input: tile,
        tile: true,
        blend: "over",
      },
    ])
    .png()
    .toBuffer();

  await sharp(background)
    .composite([{ input: options.inputPath, left: 0, top: 0, blend: "over" }])
    .png()
    .toFile(options.outputPath);

  return { width, height, preset: options.preset };
}
