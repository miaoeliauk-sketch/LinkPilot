import { basename, extname } from "node:path";
import { defaultDecorations } from "./defaults.js";
import {
  DECORATION_ASSET_IDS,
  type DecorationAssetId,
  type PortableDecorationSpec,
} from "./types.js";

export const INTENSITIES = ["light", "standard", "rich"] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const CHROMA_KEYS = ["#00FF00", "#FF00FF"] as const;
export type ChromaKey = (typeof CHROMA_KEYS)[number];

interface IntensityProfile {
  label: "轻度" | "标准" | "浓郁";
  technique: string;
  decorationCount: number;
  decorationScale: number;
  decorationOpacity: number;
}

export interface BuildGenerationPlanInput {
  sourceImage: string;
  intensity: Intensity;
  subject: string;
  colorMapping: string;
  purpose: string;
  chromaKey: ChromaKey;
}

export interface GenerationPlan {
  sourceImage: string;
  runId: string;
  suggestedOutputName: string;
  intensity: Intensity;
  label: IntensityProfile["label"];
  prompt: string;
  decorations: PortableDecorationSpec[];
}

export interface IntensityComparisonPlan {
  sourceImage: string;
  runCount: 3;
  runs: GenerationPlan[];
}

const PROFILES: Record<Intensity, IntensityProfile> = {
  light: {
    label: "轻度",
    technique:
      "保留原图大部分写实感，仅做轻微工笔白描线条化和低饱和国风色调统一，结构线少而疏朗",
    decorationCount: 1,
    decorationScale: 0.85,
    decorationOpacity: 0.72,
  },
  standard: {
    label: "标准",
    technique:
      "使用明确的工笔白描手绘线稿和国风配色，线条粗细均匀，结构线疏朗，留白比例高",
    decorationCount: 2,
    decorationScale: 1,
    decorationOpacity: 1,
  },
  rich: {
    label: "浓郁",
    technique:
      "使用强烈的工笔与水墨表现，强化轮廓和国风色彩层次，但保持线条清晰、留白充足，不增加大面积阴影",
    decorationCount: 3,
    decorationScale: 1.12,
    decorationOpacity: 1.1,
  },
};

const PALETTE = "#C23531/#2E4057/#F5F0E8/#E8B004/#A0522D";

function isDecorationAssetId(value: string): value is DecorationAssetId {
  return DECORATION_ASSET_IDS.includes(value as DecorationAssetId);
}

export function buildGenerationPlan(
  input: BuildGenerationPlanInput,
): GenerationPlan {
  const profile = PROFILES[input.intensity];
  const prompt = [
    `场景/背景：使用纯色${input.chromaKey}色度键背景，用于后续本地抠图；这是随后删除的临时技术色，不参与最终色板验收`,
    `主体：${input.subject}；仅改变绘画技法，不改变身份、姿势、轮廓、手持物品和视角；颜色映射：${input.colorMapping}，不保留原始色相`,
    `细节：${profile.technique}；发丝和衣褶仅允许少量疏朗结构线，禁止密集平行排线、交叉影线、铅笔素描质感和雕版画式大面积阴影`,
    `用途：${input.purpose}；模型实际输出尺寸可能与请求不一致，生成后由程序统一缩放`,
    `限制：除自然、低饱和的暖中性人物肤色和随后删除的临时色度键背景外，仅使用色板${PALETTE}；主体不得使用${input.chromaKey}；禁止欧美卡通风、日漫风、写实照片质感和非中式元素`,
  ].join("\n");
  const decorations = defaultDecorations()
    .slice(0, profile.decorationCount)
    .map((decoration): PortableDecorationSpec => {
      if (!isDecorationAssetId(decoration.id)) {
        throw new Error(`未知的内置装饰素材：${decoration.id}`);
      }

      return {
        id: decoration.id,
        asset: decoration.id,
        widthRatio: Number(
          (decoration.widthRatio * profile.decorationScale).toFixed(4),
        ),
        opacity: Number(
          Math.min(
            1,
            decoration.opacity * profile.decorationOpacity,
          ).toFixed(4),
        ),
        marginRatio: decoration.marginRatio,
        preferredAnchors: decoration.preferredAnchors,
      };
    });

  const sourceFilename = basename(input.sourceImage);
  const sourceStem = basename(sourceFilename, extname(sourceFilename));

  return {
    sourceImage: input.sourceImage,
    runId: `${input.intensity}-1`,
    suggestedOutputName: `${sourceStem}-inkpilot-${input.intensity}.png`,
    intensity: input.intensity,
    label: profile.label,
    prompt,
    decorations,
  };
}

export function buildIntensityComparisonPlan(
  input: Omit<BuildGenerationPlanInput, "intensity">,
): IntensityComparisonPlan {
  return {
    sourceImage: input.sourceImage,
    runCount: 3,
    runs: INTENSITIES.map((intensity) =>
      buildGenerationPlan({ ...input, intensity }),
    ),
  };
}
