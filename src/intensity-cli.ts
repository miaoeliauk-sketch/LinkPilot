import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseOptionPairs, runCliIfMain } from "./cli-utils.js";
import {
  buildGenerationPlan,
  buildIntensityComparisonPlan,
  CHROMA_KEYS,
  INTENSITIES,
  type ChromaKey,
} from "./intensity.js";

const LEVELS = [...INTENSITIES, "all"] as const;
type IntensityLevel = (typeof LEVELS)[number];

function usage() {
  return [
    "用法：",
    "  pnpm intensity -- --level <light|standard|rich|all> --source <源图> --subject <主体描述> --mapping <颜色映射> --output <计划JSON>",
    "可选：--purpose <用途> --chroma-key <#00FF00|#FF00FF>",
  ].join("\n");
}

function parseArguments(argumentsList: string[]) {
  const values = parseOptionPairs(argumentsList, usage());

  const level = values.get("--level");
  const sourceImage = values.get("--source");
  const subject = values.get("--subject");
  const colorMapping = values.get("--mapping");
  const outputPath = values.get("--output");
  const chromaKey = values.get("--chroma-key") ?? "#00FF00";

  if (
    !level ||
    !LEVELS.includes(level as IntensityLevel) ||
    !sourceImage ||
    !subject ||
    !colorMapping ||
    !outputPath ||
    !CHROMA_KEYS.includes(chromaKey as ChromaKey)
  ) {
    throw new Error(usage());
  }

  return {
    sourceImage: resolve(sourceImage),
    intensity: level as IntensityLevel,
    subject,
    colorMapping,
    purpose:
      values.get("--purpose") ??
      "国风知识卡片贴纸素材，正方形，1024×1024",
    chromaKey: chromaKey as ChromaKey,
    outputPath: resolve(outputPath),
  };
}

export async function runIntensityCli(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  const planInput = {
    sourceImage: options.sourceImage,
    subject: options.subject,
    colorMapping: options.colorMapping,
    purpose: options.purpose,
    chromaKey: options.chromaKey,
  };
  const plan =
    options.intensity === "all"
      ? buildIntensityComparisonPlan(planInput)
      : buildGenerationPlan({ ...planInput, intensity: options.intensity });

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(
    options.outputPath,
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8",
  );

  const summary =
    "runs" in plan
      ? `对比运行：${plan.runCount}次`
      : `强度：${plan.label}，装饰：${plan.decorations.length}个`;
  process.stdout.write(`已生成计划：${options.outputPath}\n${summary}\n`);
}

runCliIfMain(import.meta.url, runIntensityCli);
