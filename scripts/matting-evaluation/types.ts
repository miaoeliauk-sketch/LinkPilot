export type AlphaBand = "opaque" | "semi" | "transparent";

export interface AlphaThresholds {
  /** alpha >= 此值判定为完全不透明 */
  opaqueMin: number;
  /** alpha <= 此值判定为完全透明 */
  transparentMax: number;
}

export const DEFAULT_ALPHA_THRESHOLDS: AlphaThresholds = {
  opaqueMin: 250,
  transparentMax: 5,
};

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface RegionCounts {
  opaque: number;
  semi: number;
  transparent: number;
  total: number;
}

export interface FalsePositiveResult {
  pixelCount: number;
  ratio: number;
}

export interface MaskVersion {
  regionType: "core" | "detail";
  version: string;
  filePath: string;
}

export interface EvaluationParams {
  alphaThresholds: AlphaThresholds;
  detailBufferRadiusPixels: number;
}

export interface EvaluationResult {
  materialId: string;
  route: "chroma-key" | "ai-matting";
  runIndex: string;
  coreRetentionRate: number;
  detailOpaqueRetentionRate: number;
  detailSemiTransparentRatio: number;
  detailTransparentLossRate: number;
  obviousFalsePositiveArea: FalsePositiveResult;
  detailFalsePositiveArea: FalsePositiveResult & { bufferRadiusPixels: number };
  maskVersions: { core: MaskVersion; detail: MaskVersion };
  params: EvaluationParams;
  scriptVersion: string;
  computedAt: string;
  inputFiles: {
    outputImage: string;
    coreMask: string;
    detailMask: string;
  };
}
