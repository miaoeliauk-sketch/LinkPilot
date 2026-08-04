import { classifyAlpha, DEFAULT_ALPHA_THRESHOLDS } from "./alpha-classify.js";
import type {
  AlphaThresholds,
  FalsePositiveResult,
  ImageDimensions,
  RegionCounts,
} from "./types.js";

/**
 * 纯函数模块：不读文件、不依赖sharp，只对已经解码好的像素数组做计算。
 * mask 约定：Uint8Array，逐像素取值只能是 0（背景）或 255（主体），与alphaChannel等长。
 * 对应《V0.2-智能抠图测试设计表.md》第六节公式。
 */

function assertSameLength(a: number, b: number, label: string): void {
  if (a !== b) {
    throw new Error(`${label}：数组长度不一致（${a} vs ${b}）`);
  }
}

function assertBinaryMask(mask: Uint8Array, label: string): void {
  for (let i = 0; i < mask.length; i += 1) {
    const value = mask[i];
    if (value !== 0 && value !== 255) {
      throw new Error(
        `${label}：包含非二值像素（值=${value}，索引=${i}），需要重新导出严格二值（0/255）蒙版`,
      );
    }
  }
}

/** 统计蒙版内（=255部分）各alpha档位的像素数 */
export function countRegionBands(
  mask: Uint8Array,
  alphaChannel: Uint8Array,
  thresholds: AlphaThresholds = DEFAULT_ALPHA_THRESHOLDS,
  label = "蒙版区域",
): RegionCounts {
  assertSameLength(mask.length, alphaChannel.length, label);
  assertBinaryMask(mask, label);

  let opaque = 0;
  let semi = 0;
  let transparent = 0;
  let total = 0;

  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] !== 255) continue;
    total += 1;
    const band = classifyAlpha(alphaChannel[i], thresholds);
    if (band === "opaque") opaque += 1;
    else if (band === "semi") semi += 1;
    else transparent += 1;
  }

  if (total === 0) {
    throw new Error(`${label}：蒙版内没有任何主体像素（全为背景），无法计算比例`);
  }

  return { opaque, semi, transparent, total };
}

/** 核心保留率：核心区域蒙版中完全不透明像素占比 */
export function coreRetentionRate(counts: RegionCounts): number {
  return (counts.opaque / counts.total) * 100;
}

/** 细节完全不透明保留率：细节区域蒙版中完全不透明像素占比（不含半透明部分） */
export function detailOpaqueRetentionRate(counts: RegionCounts): number {
  return (counts.opaque / counts.total) * 100;
}

/** 细节半透明占比：细节区域蒙版中落在半透明过渡区间的像素占比 */
export function detailSemiTransparentRatio(counts: RegionCounts): number {
  return (counts.semi / counts.total) * 100;
}

/** 细节完全透明丢失率：细节区域蒙版中完全透明（真正丢失）像素占比，不是100%-保留率 */
export function detailTransparentLossRate(counts: RegionCounts): number {
  return (counts.transparent / counts.total) * 100;
}

/**
 * 自检：保留率+半透明占比+丢失率理论上必须等于100%（三档alpha互斥穷尽）。
 * 用于捕获计算实现本身的bug，而不是给出可能有误的数字。
 */
export function assertRatiosSumTo100(
  retentionRate: number,
  semiRatio: number,
  lossRate: number,
  tolerancePercent = 0.01,
): void {
  const sum = retentionRate + semiRatio + lossRate;
  if (Math.abs(sum - 100) > tolerancePercent) {
    throw new Error(
      `保留率+半透明占比+丢失率之和应为100%，实际为${sum.toFixed(4)}%，超出容差±${tolerancePercent}%，判定为内部计算错误，不输出结果`,
    );
  }
}

/** 明显误抠面积：被判定为完全不透明、但既不在核心蒙版也不在细节蒙版内的像素 */
export function obviousFalsePositiveArea(
  coreMask: Uint8Array,
  detailMask: Uint8Array,
  alphaChannel: Uint8Array,
  dims: ImageDimensions,
  thresholds: AlphaThresholds = DEFAULT_ALPHA_THRESHOLDS,
): FalsePositiveResult {
  assertSameLength(coreMask.length, alphaChannel.length, "核心蒙版");
  assertSameLength(detailMask.length, alphaChannel.length, "细节蒙版");
  assertBinaryMask(coreMask, "核心蒙版");
  assertBinaryMask(detailMask, "细节蒙版");

  const totalPixels = dims.width * dims.height;
  if (totalPixels !== alphaChannel.length) {
    throw new Error(
      `图像尺寸(${dims.width}×${dims.height}=${totalPixels})与alpha通道像素数(${alphaChannel.length})不一致`,
    );
  }

  let count = 0;
  for (let i = 0; i < alphaChannel.length; i += 1) {
    if (classifyAlpha(alphaChannel[i], thresholds) !== "opaque") continue;
    const inCoreOrDetail = coreMask[i] === 255 || detailMask[i] === 255;
    if (!inCoreOrDetail) count += 1;
  }

  return { pixelCount: count, ratio: (count / totalPixels) * 100 };
}

/**
 * 简单的方形结构元膨胀，O(width*height*radius^2)。
 * 用于生成细节区域蒙版的外扩缓冲带。对1024×1024、radius=5量级的图像可接受，
 * 若未来素材分辨率显著增大或radius显著增大，建议换成基于距离变换的实现（未实现，标注为已知优化空间）。
 */
function dilateMask(mask: Uint8Array, dims: ImageDimensions, radiusPixels: number): Uint8Array {
  const { width, height } = dims;
  if (width * height !== mask.length) {
    throw new Error(`蒙版像素数(${mask.length})与声明的尺寸(${width}×${height})不一致`);
  }
  const result = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (mask[idx] === 255) {
        result[idx] = 255;
        continue;
      }
      let found = false;
      for (let dy = -radiusPixels; dy <= radiusPixels && !found; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radiusPixels; dx <= radiusPixels; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[ny * width + nx] === 255) {
            found = true;
            break;
          }
        }
      }
      result[idx] = found ? 255 : 0;
    }
  }

  return result;
}

/**
 * 细节误抠面积：明显误抠中，落在"细节区域蒙版外扩缓冲带"内的部分。
 * 缓冲带宽度默认5像素，与测试表第六节一致，可通过参数覆盖（测试表第九节标注为待确认参数）。
 */
export function detailFalsePositiveArea(
  detailMask: Uint8Array,
  alphaChannel: Uint8Array,
  dims: ImageDimensions,
  bufferRadiusPixels = 5,
  thresholds: AlphaThresholds = DEFAULT_ALPHA_THRESHOLDS,
): FalsePositiveResult & { bufferRadiusPixels: number } {
  assertSameLength(detailMask.length, alphaChannel.length, "细节蒙版");
  assertBinaryMask(detailMask, "细节蒙版");

  const dilated = dilateMask(detailMask, dims, bufferRadiusPixels);

  let bufferTotal = 0;
  let falsePositiveInBuffer = 0;

  for (let i = 0; i < dilated.length; i += 1) {
    if (dilated[i] !== 255) continue;
    bufferTotal += 1;
    const isOpaque = classifyAlpha(alphaChannel[i], thresholds) === "opaque";
    const isOriginalDetail = detailMask[i] === 255;
    if (isOpaque && !isOriginalDetail) {
      falsePositiveInBuffer += 1;
    }
  }

  if (bufferTotal === 0) {
    throw new Error("细节区域外扩缓冲带为空（细节蒙版可能为空），无法计算细节误抠面积占比");
  }

  return {
    pixelCount: falsePositiveInBuffer,
    ratio: (falsePositiveInBuffer / bufferTotal) * 100,
    bufferRadiusPixels,
  };
}
