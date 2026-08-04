import { DEFAULT_ALPHA_THRESHOLDS, type AlphaBand, type AlphaThresholds } from "./types.js";

export { DEFAULT_ALPHA_THRESHOLDS };

/**
 * 三档互斥且穷尽，判定规则与《V0.2-智能抠图测试设计表.md》第五节逐字对应：
 * alpha >= opaqueMin 完全不透明；alpha <= transparentMax 完全透明；其余半透明。
 */
export function classifyAlpha(
  alpha: number,
  thresholds: AlphaThresholds = DEFAULT_ALPHA_THRESHOLDS,
): AlphaBand {
  if (!Number.isInteger(alpha) || alpha < 0 || alpha > 255) {
    throw new Error(`alpha值必须是0-255之间的整数，实际为：${alpha}`);
  }
  if (thresholds.opaqueMin <= thresholds.transparentMax) {
    throw new Error(
      `alpha阈值配置错误：不透明下限(${thresholds.opaqueMin})必须大于透明上限(${thresholds.transparentMax})`,
    );
  }
  if (alpha >= thresholds.opaqueMin) return "opaque";
  if (alpha <= thresholds.transparentMax) return "transparent";
  return "semi";
}
