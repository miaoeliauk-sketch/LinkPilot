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
  styleRestriction: string;
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
      "保留自然明暗和材质纹理，以低饱和国风配色统一画面；不进行通篇线稿化，只在主体外轮廓和少数关键结构转折处使用极淡、极少的赭石结构线，主要色块保持平滑与自然层次",
    styleRestriction:
      "允许保留自然照片质感作为底层，但避免照片级锐利细节和商业棚拍光泽",
    decorationCount: 1,
    decorationScale: 0.85,
    decorationOpacity: 0.72,
  },
  standard: {
    label: "标准",
    technique:
      "使用明确的工笔白描手绘线稿、平面化色块和国风配色，线条粗细均匀，结构线疏朗，保留适量纸本肌理与留白",
    styleRestriction: "禁止写实照片质感，保持清晰的手绘插画表现",
    decorationCount: 2,
    decorationScale: 1,
    decorationOpacity: 1,
  },
  rich: {
    label: "浓郁",
    technique:
      "使用浓郁的工笔与水墨表现，主体轮廓更加清晰，主体边缘和主要色块加入可见的干笔飞白、湿墨晕染、墨色浓淡变化和不规则笔触边缘，同时保持结构线粗细均匀；水墨笔触必须一眼可见，主体关键细节保持清晰并保留必要留白，不增加大面积黑色阴影",
    styleRestriction:
      "禁止写实照片质感，必须呈现明显的传统水墨纸本和手工笔触质感",
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
    `细节：${profile.technique}；人物发丝和衣褶（如有）仅允许少量疏朗结构线，禁止密集平行排线、交叉影线、铅笔素描质感和雕版画式大面积阴影`,
    `用途：${input.purpose}；模型实际输出尺寸可能与请求不一致，生成后由程序统一缩放`,
    `限制：除自然、低饱和的暖中性人物肤色和随后删除的临时色度键背景外，仅使用色板${PALETTE}；主体不得使用${input.chromaKey}；${profile.styleRestriction}；禁止欧美卡通风、日漫风和非中式元素`,
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
