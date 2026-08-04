import { stat } from "node:fs/promises";
import sharp from "sharp";
import {
  assertRatiosSumTo100,
  coreRetentionRate,
  countRegionBands,
  detailFalsePositiveArea,
  detailOpaqueRetentionRate,
  detailSemiTransparentRatio,
  detailTransparentLossRate,
  obviousFalsePositiveArea,
} from "./metrics.js";
import { readMaskPixels, toMaskVersion } from "./mask-io.js";
import { captureEnvSnapshot, SCRIPT_VERSION } from "./env-snapshot.js";
import { toJson, toMarkdownSummary } from "./report.js";
import { DEFAULT_ALPHA_THRESHOLDS } from "./types.js";
import type { EvaluationResult } from "./types.js";

/**
 * 命令行入口。不依赖 src/ 下任何模块，独立于正式pipeline。
 * 不生成图片，不调用Codex，只读取已有文件。
 *
 * 用法：
 *   tsx scripts/matting-evaluation/cli.ts \
 *     --output <抠图结果PNG> --core-mask <核心蒙版PNG> --detail-mask <细节蒙版PNG> \
 *     --material-id HAIR-01 --route ai-matting --run-index 1
 */

function usage(): string {
  return [
    "用法：",
    "  tsx scripts/matting-evaluation/cli.ts --output <PNG> --core-mask <PNG> --detail-mask <PNG> \\",
    "    --material-id <编号> --route <chroma-key|ai-matting> --run-index <序号>",
    "可选：--buffer-radius <像素，默认5> --opaque-min <alpha，默认250> --transparent-max <alpha，默认5>",
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

async function readOutputAlphaChannel(
  path: string,
): Promise<{ alpha: Uint8Array; width: number; height: number }> {
  try {
    await stat(path);
  } catch {
    throw new Error(`抠图结果图不存在：${path}`);
  }

  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`抠图结果图无法解码（可能已损坏或不是有效图片格式）：${path}（${message}）`);
    });

  if (info.channels !== 4) {
    throw new Error(`输入图片必须能转换为RGBA格式，实际通道数为${info.channels}：${path}`);
  }

  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = data[i * 4 + 3];
  }
  return { alpha, width: info.width, height: info.height };
}

function assertSameDimensions(
  a: { width: number; height: number },
  b: { width: number; height: number },
  labelA: string,
  labelB: string,
): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `${labelA}尺寸(${a.width}×${a.height})与${labelB}尺寸(${b.width}×${b.height})不一致，` +
        `不能仅凭像素总数相同就判定尺寸一致（例如10×20与20×10总数相同但排列不同）`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const required = ["output", "core-mask", "detail-mask", "material-id", "route", "run-index"];
  for (const key of required) {
    if (!args[key]) {
      throw new Error(usage());
    }
  }
  if (args.route !== "chroma-key" && args.route !== "ai-matting") {
    throw new Error(`--route 必须是 chroma-key 或 ai-matting，实际为：${args.route}`);
  }

  const thresholds = {
    opaqueMin: args["opaque-min"] ? Number(args["opaque-min"]) : DEFAULT_ALPHA_THRESHOLDS.opaqueMin,
    transparentMax: args["transparent-max"]
      ? Number(args["transparent-max"])
      : DEFAULT_ALPHA_THRESHOLDS.transparentMax,
  };
  const bufferRadiusPixels = args["buffer-radius"] ? Number(args["buffer-radius"]) : 5;

  const { alpha, width, height } = await readOutputAlphaChannel(args.output);
  const coreMask = await readMaskPixels(args["core-mask"]);
  const detailMask = await readMaskPixels(args["detail-mask"]);

  assertSameDimensions({ width, height }, coreMask, "抠图结果图", "核心区域蒙版");
  assertSameDimensions({ width, height }, detailMask, "抠图结果图", "细节区域蒙版");

  const coreCounts = countRegionBands(coreMask.data, alpha, thresholds, "核心区域蒙版");
  const detailCounts = countRegionBands(detailMask.data, alpha, thresholds, "细节区域蒙版");

  const coreRate = coreRetentionRate(coreCounts);
  const detailOpaqueRate = detailOpaqueRetentionRate(detailCounts);
  const detailSemiRatio = detailSemiTransparentRatio(detailCounts);
  const detailLossRate = detailTransparentLossRate(detailCounts);
  assertRatiosSumTo100(detailOpaqueRate, detailSemiRatio, detailLossRate);

  const obviousFP = obviousFalsePositiveArea(coreMask.data, detailMask.data, alpha, { width, height }, thresholds);
  const detailFP = detailFalsePositiveArea(
    detailMask.data,
    alpha,
    { width, height },
    bufferRadiusPixels,
    thresholds,
  );

  const result: EvaluationResult = {
    materialId: args["material-id"],
    route: args.route as "chroma-key" | "ai-matting",
    runIndex: args["run-index"],
    coreRetentionRate: coreRate,
    detailOpaqueRetentionRate: detailOpaqueRate,
    detailSemiTransparentRatio: detailSemiRatio,
    detailTransparentLossRate: detailLossRate,
    obviousFalsePositiveArea: obviousFP,
    detailFalsePositiveArea: detailFP,
    maskVersions: {
      core: toMaskVersion(args["core-mask"]),
      detail: toMaskVersion(args["detail-mask"]),
    },
    params: { alphaThresholds: thresholds, detailBufferRadiusPixels: bufferRadiusPixels },
    scriptVersion: SCRIPT_VERSION,
    computedAt: captureEnvSnapshot().timestamp,
    inputFiles: {
      outputImage: args.output,
      coreMask: args["core-mask"],
      detailMask: args["detail-mask"],
    },
  };

  process.stdout.write(`${toJson(result)}\n\n${toMarkdownSummary(result)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
