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
 * 骨架命令行入口，未在本环境实际运行验证。
 * 不依赖 src/ 下任何模块，独立于正式pipeline。
 * 不生成图片，不调用Codex，只读取已有文件。
 *
 * 用法（设计意图）：
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
  _path: string,
): Promise<{ alpha: Uint8Array; width: number; height: number }> {
  // TODO（骨架，未实现/未验证）：用 sharp 读取RGBA并提取alpha通道。
  // const { data, info } = await sharp(_path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // if (info.channels !== 4) throw new Error(`输入图片必须能转换为RGBA格式：${_path}`);
  // const alpha = new Uint8Array(info.width * info.height);
  // for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
  // return { alpha, width: info.width, height: info.height };
  throw new Error(
    "readOutputAlphaChannel 尚未实现：需要在装有sharp依赖的实际开发环境中补全，本次未验证。",
  );
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
