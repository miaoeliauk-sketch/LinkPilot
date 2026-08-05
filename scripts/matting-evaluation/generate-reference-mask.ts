import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

/**
 * 参考蒙版"自动初判 + 边缘人工复核"生成工具。
 * 对应《V0.2-智能抠图测试设计表.md》第四节蒙版规范的第三种标注路径（算法辅助标注）。
 *
 * 边界：只读取已有的纯色度键背景源图，做像素分类和形态学处理，不生成新图片，不调用Codex，
 * 不import src/下任何模块。产出的是"草稿"蒙版，必须经人工核对review-overlay后才能去掉
 * -draft后缀、按《V0.2-素材蒙版与授权检查规范.md》命名规则冻结为正式版本。
 *
 * 方法论说明（必须随产出物一起理解，不要只看代码）：
 * - 色度距离"明显接近背景色"或"明显远离背景色"的像素，自动判定为背景/前景。
 * - 处于中间模糊地带的像素（集中在发丝末梢、叶尖等边缘），不直接自动判定，而是：
 *   ①在草稿二值蒙版中用中点规则给一个默认归类，②同时输出review-overlay标出这些像素，
 *   要求人工逐一确认默认归类是否正确，确认/修正后才能冻结。
 * - 核心区域 = 高置信前景像素向内腐蚀后剩下的部分（腐蚀半径可调）；
 *   细节区域 = （高置信前景 − 核心区域）∪ 模糊区域——即主体的边缘带，天然覆盖发丝/叶尖。
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Dimensions {
  width: number;
  height: number;
}

interface Thresholds {
  /** 色度距离 <= 此值：判定为高置信背景 */
  backgroundMax: number;
  /** 色度距离 >= 此值：判定为高置信前景 */
  foregroundMin: number;
}

/** 默认参数：测试设计阶段的预设值，未在真实素材上校准，使用前需要你用真实图核对是否合适 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  backgroundMax: 40,
  foregroundMin: 140,
};
export const DEFAULT_CORE_EROSION_RADIUS = 6;

export const CHROMA_KEYS: Record<string, RGB> = {
  green: { r: 0, g: 255, b: 0 },
  magenta: { r: 255, g: 0, b: 255 },
};

export function parseChromaKey(value: string): RGB {
  if (value in CHROMA_KEYS) {
    return CHROMA_KEYS[value];
  }
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (!match) {
    throw new Error(`--chroma 必须是 green / magenta / #RRGGBB 十六进制颜色，实际为：${value}`);
  }
  const hex = match[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function colorDistance(pixel: RGB, key: RGB): number {
  const dr = pixel.r - key.r;
  const dg = pixel.g - key.g;
  const db = pixel.b - key.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export type PixelBand = "background" | "foreground" | "ambiguous";

export function classifyByDistance(distance: number, thresholds: Thresholds): PixelBand {
  if (thresholds.backgroundMax >= thresholds.foregroundMin) {
    throw new Error(
      `阈值配置错误：backgroundMax(${thresholds.backgroundMax})必须小于foregroundMin(${thresholds.foregroundMin})`,
    );
  }
  if (distance <= thresholds.backgroundMax) return "background";
  if (distance >= thresholds.foregroundMin) return "foreground";
  return "ambiguous";
}

export interface RawClassification {
  bands: PixelBand[];
  width: number;
  height: number;
  ambiguousCount: number;
  backgroundCount: number;
  foregroundCount: number;
}

/** 对RGB像素数组逐像素分类，rgb长度必须是width*height*3（不含alpha，源图本身没有透明通道） */
export function classifyImage(
  rgb: Uint8Array,
  dims: Dimensions,
  key: RGB,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): RawClassification {
  const pixelCount = dims.width * dims.height;
  if (rgb.length !== pixelCount * 3) {
    throw new Error(
      `RGB数据长度(${rgb.length})与声明尺寸(${dims.width}×${dims.height}×3=${pixelCount * 3})不一致`,
    );
  }

  const bands: PixelBand[] = new Array(pixelCount);
  let ambiguousCount = 0;
  let backgroundCount = 0;
  let foregroundCount = 0;

  for (let i = 0; i < pixelCount; i += 1) {
    const idx = i * 3;
    const distance = colorDistance({ r: rgb[idx], g: rgb[idx + 1], b: rgb[idx + 2] }, key);
    const band = classifyByDistance(distance, thresholds);
    bands[i] = band;
    if (band === "ambiguous") ambiguousCount += 1;
    else if (band === "background") backgroundCount += 1;
    else foregroundCount += 1;
  }

  return { bands, width: dims.width, height: dims.height, ambiguousCount, backgroundCount, foregroundCount };
}

/** 草稿二值蒙版：高置信前景=255，其余（含模糊区中点默认判为背景）=0——中点规则见下方说明 */
export function draftBinaryForegroundMask(classification: RawClassification): Uint8Array {
  const mask = new Uint8Array(classification.bands.length);
  for (let i = 0; i < classification.bands.length; i += 1) {
    mask[i] = classification.bands[i] === "foreground" ? 255 : 0;
  }
  return mask;
}

/** 简单形态学腐蚀：只保留距离最近背景像素超过radius的前景像素，作为"核心区域"草稿 */
export function erode(mask: Uint8Array, dims: Dimensions, radius: number): Uint8Array {
  const { width, height } = dims;
  if (width * height !== mask.length) {
    throw new Error(`蒙版像素数(${mask.length})与声明尺寸(${width}×${height})不一致`);
  }
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (mask[idx] !== 255) {
        result[idx] = 0;
        continue;
      }
      let allForeground = true;
      for (let dy = -radius; dy <= radius && allForeground; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          allForeground = false;
          break;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || mask[ny * width + nx] !== 255) {
            allForeground = false;
            break;
          }
        }
      }
      result[idx] = allForeground ? 255 : 0;
    }
  }
  return result;
}

/** 核心蒙版：高置信前景腐蚀后的内部实体；细节蒙版：（高置信前景−核心）∪ 模糊区域（发丝/叶尖天然落在这里） */
export function buildCoreAndDetailMasks(
  classification: RawClassification,
  coreErosionRadius: number = DEFAULT_CORE_EROSION_RADIUS,
): { core: Uint8Array; detail: Uint8Array } {
  const dims = { width: classification.width, height: classification.height };
  const confidentForeground = draftBinaryForegroundMask(classification);
  const core = erode(confidentForeground, dims, coreErosionRadius);

  const detail = new Uint8Array(classification.bands.length);
  for (let i = 0; i < classification.bands.length; i += 1) {
    const isForegroundNotCore = confidentForeground[i] === 255 && core[i] !== 255;
    const isAmbiguous = classification.bands[i] === "ambiguous";
    detail[i] = isForegroundNotCore || isAmbiguous ? 255 : 0;
  }

  return { core, detail };
}

/** 复核叠加图：模糊区域像素标记为醒目红色，其余区域保留原图但整体调暗，便于肉眼快速定位待复核像素 */
export function buildReviewOverlay(rgb: Uint8Array, classification: RawClassification): Uint8Array {
  const pixelCount = classification.bands.length;
  const overlay = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    const srcIdx = i * 3;
    const dstIdx = i * 3;
    if (classification.bands[i] === "ambiguous") {
      overlay[dstIdx] = 255;
      overlay[dstIdx + 1] = 0;
      overlay[dstIdx + 2] = 0;
    } else {
      overlay[dstIdx] = Math.round(rgb[srcIdx] * 0.4);
      overlay[dstIdx + 1] = Math.round(rgb[srcIdx + 1] * 0.4);
      overlay[dstIdx + 2] = Math.round(rgb[srcIdx + 2] * 0.4);
    }
  }
  return overlay;
}

async function writeGreyPng(path: string, mask: Uint8Array, dims: Dimensions): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await sharp(Buffer.from(mask), { raw: { width: dims.width, height: dims.height, channels: 1 } })
    .png()
    .toFile(path);
}

async function writeRgbPng(path: string, rgb: Uint8Array, dims: Dimensions): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await sharp(Buffer.from(rgb), { raw: { width: dims.width, height: dims.height, channels: 3 } })
    .png()
    .toFile(path);
}

function usage(): string {
  return [
    "用法：",
    "  tsx scripts/matting-evaluation/generate-reference-mask.ts --source <源PNG> --chroma <green|magenta|#RRGGBB> \\",
    "    --material-id <编号> --out-dir <输出目录>",
    "可选：--bg-max <色度距离，默认40> --fg-min <色度距离，默认140> --core-erosion <像素，默认6>",
  ].join("\n");
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(usage());
    }
    values[key.slice(2)] = value;
  }
  return values;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const key of ["source", "chroma", "material-id", "out-dir"]) {
    if (!args[key]) throw new Error(usage());
  }

  const key = parseChromaKey(args.chroma);
  const thresholds: Thresholds = {
    backgroundMax: args["bg-max"] ? Number(args["bg-max"]) : DEFAULT_THRESHOLDS.backgroundMax,
    foregroundMin: args["fg-min"] ? Number(args["fg-min"]) : DEFAULT_THRESHOLDS.foregroundMin,
  };
  const coreErosionRadius = args["core-erosion"]
    ? Number(args["core-erosion"])
    : DEFAULT_CORE_EROSION_RADIUS;

  const { data, info } = await sharp(args.source)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`源图无法解码：${args.source}（${message}）`);
    });

  if (info.channels !== 3) {
    throw new Error(`源图去除alpha后通道数应为3，实际为${info.channels}：${args.source}`);
  }

  const dims = { width: info.width, height: info.height };
  const classification = classifyImage(new Uint8Array(data), dims, key, thresholds);
  const { core, detail } = buildCoreAndDetailMasks(classification, coreErosionRadius);
  const overlay = buildReviewOverlay(new Uint8Array(data), classification);

  const id = args["material-id"];
  const outDir = args["out-dir"];
  await writeGreyPng(join(outDir, `${id}-core-draft.png`), core, dims);
  await writeGreyPng(join(outDir, `${id}-detail-draft.png`), detail, dims);
  await writeRgbPng(join(outDir, `${id}-review-overlay.png`), overlay, dims);

  const report = {
    materialId: id,
    sourceImage: args.source,
    chromaKey: args.chroma,
    thresholds,
    coreErosionRadius,
    imageSize: dims,
    totalPixels: dims.width * dims.height,
    backgroundPixels: classification.backgroundCount,
    foregroundPixels: classification.foregroundCount,
    ambiguousPixels: classification.ambiguousCount,
    ambiguousRatioPercent: (classification.ambiguousCount / (dims.width * dims.height)) * 100,
    needsManualReview: classification.ambiguousCount > 0,
    generatedAt: new Date().toISOString(),
  };
  const reportPath = join(outDir, `${id}-mask-generation-report.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  process.stdout.write(
    `已生成草稿蒙版：${id}-core-draft.png / ${id}-detail-draft.png\n` +
      `复核叠加图：${id}-review-overlay.png（红色=待人工确认区域，共${classification.ambiguousCount}像素，占比${report.ambiguousRatioPercent.toFixed(2)}%）\n` +
      `报告：${reportPath}\n` +
      `提醒：这是草稿（-draft后缀），必须经人工核对review-overlay、确认/修正模糊区域归类后，` +
      `按素材蒙版规范重新命名为正式版本（去掉-draft，加版本号）才能用于正式测试。\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
