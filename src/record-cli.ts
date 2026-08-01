import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { parseOptionPairs, runCliIfMain } from "./cli-utils.js";
import type { GenerationPlan } from "./intensity.js";
import {
  SOURCE_TYPE_OPTIONS,
  sourceTypeFromOption,
  writeGenerationRecord,
  type SourceTypeOption,
} from "./metadata.js";

function usage() {
  return [
    "用法：",
    "  pnpm record -- --plan <强度计划JSON> --run-id <运行编号> --output <实际结果PNG> --source-type <real|ai>",
    "可选：--model <模型版本> --records-dir <记录目录>",
  ].join("\n");
}

function parseArguments(argumentsList: string[]) {
  const values = parseOptionPairs(argumentsList, usage());
  const planPath = values.get("--plan");
  const runId = values.get("--run-id");
  const outputPath = values.get("--output");
  const sourceType = values.get("--source-type");

  if (
    !planPath ||
    !runId ||
    !outputPath ||
    !sourceType ||
    !SOURCE_TYPE_OPTIONS.includes(sourceType as SourceTypeOption)
  ) {
    throw new Error(usage());
  }

  return {
    planPath: resolve(planPath),
    runId,
    outputPath: resolve(outputPath),
    sourceType: sourceType as SourceTypeOption,
    model: values.get("--model") ?? "gpt-image-2",
    recordsDirectory: values.get("--records-dir")
      ? resolve(values.get("--records-dir")!)
      : undefined,
  };
}

function isGenerationPlan(value: unknown): value is GenerationPlan {
  if (!value || typeof value !== "object") {
    return false;
  }
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.sourceImage === "string" &&
    typeof plan.runId === "string" &&
    typeof plan.intensity === "string" &&
    typeof plan.label === "string" &&
    typeof plan.prompt === "string"
  );
}

async function loadRun(planPath: string, runId: string) {
  const parsed = JSON.parse(await readFile(planPath, "utf8")) as unknown;
  const candidates =
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { runs?: unknown }).runs)
      ? (parsed as { runs: unknown[] }).runs
      : [parsed];
  const run = candidates.find(
    (candidate) =>
      isGenerationPlan(candidate) && candidate.runId === runId,
  );
  if (!isGenerationPlan(run)) {
    throw new Error(`计划中找不到运行编号：${runId}`);
  }
  return run;
}

async function validateImage(path: string, label: string) {
  try {
    const file = await stat(path);
    if (!file.isFile()) {
      throw new Error("not a file");
    }
    const metadata = await sharp(path).metadata();
    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new Error("not a readable image");
    }
  } catch {
    throw new Error(`${label}不可用：${path}`);
  }
}

export async function runRecordCli(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  const run = await loadRun(options.planPath, options.runId);
  await validateImage(run.sourceImage, "原图");
  await validateImage(options.outputPath, "实际结果图片");
  const recordPath = await writeGenerationRecord({
    inputImage: run.sourceImage,
    sourceType: sourceTypeFromOption(options.sourceType),
    params: {
      操作: "AI国风重绘",
      国风强度: run.label,
      模型版本: options.model,
      prompt: run.prompt,
      运行编号: run.runId,
    },
    outputImage: options.outputPath,
    recordsDirectory: options.recordsDirectory,
  });
  process.stdout.write(
    `已登记实际结果：${options.outputPath}\n记录：${recordPath}\n`,
  );
}

runCliIfMain(import.meta.url, runRecordCli);
