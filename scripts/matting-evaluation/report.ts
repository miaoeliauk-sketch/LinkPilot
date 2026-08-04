import type { EvaluationResult } from "./types.js";

/** 输出JSON：字段命名与《V0.2-智能抠图测试设计表.md》第八节决策项表保持一致，便于直接复制填表。 */
export function toJson(result: EvaluationResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * 输出人类可读的Markdown摘要片段，供直接粘贴进测试表第三节对照记录表对应行。
 * 边缘污染等级/运行时间/内存显存/重复运行稳定性等本工具不产出的字段，明确留空并提示需人工补充，
 * 不留白不提示，避免使用者以为这些字段"没有"而不是"需要另外记录"。
 */
export function toMarkdownSummary(result: EvaluationResult): string {
  const lines = [
    `### ${result.materialId} — ${result.route === "chroma-key" ? "色度键（基准）" : "智能抠图"} — 运行序号 ${result.runIndex}`,
    "",
    `| 字段 | 值 |`,
    `|---|---|`,
    `| 核心保留率 | ${result.coreRetentionRate.toFixed(2)}% |`,
    `| 细节完全不透明保留率 | ${result.detailOpaqueRetentionRate.toFixed(2)}% |`,
    `| 细节半透明占比 | ${result.detailSemiTransparentRatio.toFixed(2)}% |`,
    `| 细节完全透明丢失率 | ${result.detailTransparentLossRate.toFixed(2)}% |`,
    `| 明显误抠面积 | ${result.obviousFalsePositiveArea.pixelCount}px（${result.obviousFalsePositiveArea.ratio.toFixed(4)}%） |`,
    `| 细节误抠面积（缓冲带${result.detailFalsePositiveArea.bufferRadiusPixels}px） | ${result.detailFalsePositiveArea.pixelCount}px（${result.detailFalsePositiveArea.ratio.toFixed(4)}%） |`,
    `| 核心蒙版版本 | ${result.maskVersions.core.version} |`,
    `| 细节蒙版版本 | ${result.maskVersions.detail.version} |`,
    `| Alpha阈值参数 | 不透明≥${result.params.alphaThresholds.opaqueMin}，透明≤${result.params.alphaThresholds.transparentMax} |`,
    `| 脚本版本 | ${result.scriptVersion} |`,
    `| 计算时间 | ${result.computedAt} |`,
    "",
    "> 边缘白边/污染等级、运行时间（冷启动/热运行）、内存/显存、重复运行稳定性等字段本工具不产出，需按《V0.2-智能抠图测试设计表.md》要求人工评级或另行记录。",
  ];
  return lines.join("\n");
}
