import { describe, expect, it } from "vitest";
import {
  buildGenerationPlan,
  buildIntensityComparisonPlan,
} from "../src/intensity.js";

const baseInput = {
  sourceImage: "/tmp/day2-transparent.png",
  subject: "短发人物坐在电脑前，保持头部角度、发型、服装款式和电脑轮廓",
  colorMapping: "外套映射为黛蓝，内搭映射为月白，肤色保留自然低饱和暖色",
  purpose: "国风知识卡片贴纸素材，正方形，1024×1024",
  chromaKey: "#00FF00" as const,
};

describe("buildGenerationPlan", () => {
  it("builds three distinct five-part prompts with the same hard constraints", () => {
    const light = buildGenerationPlan({ ...baseInput, intensity: "light" });
    const standard = buildGenerationPlan({
      ...baseInput,
      intensity: "standard",
    });
    const rich = buildGenerationPlan({ ...baseInput, intensity: "rich" });

    expect([light.label, standard.label, rich.label]).toEqual([
      "轻度",
      "标准",
      "浓郁",
    ]);
    expect(new Set([light.prompt, standard.prompt, rich.prompt]).size).toBe(3);

    for (const plan of [light, standard, rich]) {
      expect(plan.prompt).toContain("场景/背景：");
      expect(plan.prompt).toContain("主体：");
      expect(plan.prompt).toContain("细节：");
      expect(plan.prompt).toContain("用途：");
      expect(plan.prompt).toContain("限制：");
      expect(plan.prompt).toContain(baseInput.subject);
      expect(plan.prompt).toContain(baseInput.colorMapping);
      expect(plan.prompt).toContain(
        "#C23531/#2E4057/#F5F0E8/#E8B004/#A0522D",
      );
      expect(plan.prompt).toContain("主体不得使用#00FF00");
      expect(plan.prompt).toContain("禁止密集平行排线");
    }

    expect(light.prompt).toContain("保留自然明暗和材质纹理");
    expect(light.prompt).toContain("不进行通篇线稿化");
    expect(light.prompt).toContain("主体外轮廓和少数关键结构转折处");
    expect(light.prompt).not.toContain("禁止写实照片质感");
    expect(standard.prompt).toContain("明确的工笔白描手绘线稿");
    expect(standard.prompt).toContain("平面化色块");
    expect(rich.prompt).toContain("干笔飞白");
    expect(rich.prompt).toContain("湿墨晕染");
    expect(rich.prompt).toContain("主体边缘和主要色块");
    expect(rich.prompt).toContain("结构线粗细均匀");
    expect(rich.prompt).toContain("水墨笔触必须一眼可见");
  });

  it("increases decoration count, size and opacity from light to rich", () => {
    const light = buildGenerationPlan({ ...baseInput, intensity: "light" });
    const standard = buildGenerationPlan({
      ...baseInput,
      intensity: "standard",
    });
    const rich = buildGenerationPlan({ ...baseInput, intensity: "rich" });

    expect(light.decorations).toHaveLength(1);
    expect(standard.decorations).toHaveLength(2);
    expect(rich.decorations).toHaveLength(3);

    expect(light.decorations[0].widthRatio).toBeLessThan(
      standard.decorations[0].widthRatio,
    );
    expect(standard.decorations[0].widthRatio).toBeLessThan(
      rich.decorations[0].widthRatio,
    );
    expect(light.decorations[0].opacity).toBeLessThan(
      standard.decorations[0].opacity,
    );
    expect(standard.decorations[0].opacity).toBeLessThan(
      rich.decorations[0].opacity,
    );
  });

  it("builds a three-run comparison plan that reuses one source image", () => {
    const comparison = buildIntensityComparisonPlan(baseInput);

    expect(comparison.sourceImage).toBe(baseInput.sourceImage);
    expect(comparison.runCount).toBe(3);
    expect(comparison.runs.map((run) => run.intensity)).toEqual([
      "light",
      "standard",
      "rich",
    ]);
    expect(
      comparison.runs.every(
        (run) => run.sourceImage === baseInput.sourceImage,
      ),
    ).toBe(true);
    expect(new Set(comparison.runs.map((run) => run.runId)).size).toBe(3);
    expect(
      new Set(comparison.runs.map((run) => run.suggestedOutputName)).size,
    ).toBe(3);
  });
});
