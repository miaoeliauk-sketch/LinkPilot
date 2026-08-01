import { resolve } from "node:path";
import { parseOptionPairs, runCliIfMain } from "./cli-utils.js";
import {
  SOURCE_TYPE_OPTIONS,
  sourceTypeFromOption,
  writeGenerationRecord,
  type SourceTypeOption,
} from "./metadata.js";
import {
  BACKGROUND_PRESETS,
  composeBackground,
  type BackgroundPreset,
} from "./background.js";

function usage() {
  return [
    "用法：",
    "  pnpm background -- --input <透明PNG> --output <输出PNG> --preset <none|grid|xuan-paper> --source-type <real|ai>",
    "可选：--records-dir <记录目录>",
  ].join("\n");
}

function parseArguments(argumentsList: string[]) {
  const values = parseOptionPairs(argumentsList, usage());

  const inputPath = values.get("--input");
  const outputPath = values.get("--output");
  const preset = values.get("--preset");
  const sourceType = values.get("--source-type");
  if (
    !inputPath ||
    !outputPath ||
    !preset ||
    !BACKGROUND_PRESETS.includes(preset as BackgroundPreset) ||
    !sourceType ||
    !SOURCE_TYPE_OPTIONS.includes(sourceType as SourceTypeOption)
  ) {
    throw new Error(usage());
  }

  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    preset: preset as BackgroundPreset,
    sourceType: sourceType as SourceTypeOption,
    recordsDirectory: values.get("--records-dir")
      ? resolve(values.get("--records-dir")!)
      : undefined,
  };
}

export async function runBackgroundCli(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  const result = await composeBackground(options);
  const recordPath = await writeGenerationRecord({
    inputImage: options.inputPath,
    sourceType: sourceTypeFromOption(options.sourceType),
    params: {
      操作: "背景图层替换与重新合成",
      国风强度: "未指定",
      模型版本: "sharp",
      prompt: "",
      背景预设: options.preset,
    },
    outputImage: options.outputPath,
    recordsDirectory: options.recordsDirectory,
  });
  process.stdout.write(
    `已生成：${options.outputPath}\n记录：${recordPath}\n画布：${result.width}×${result.height}，背景：${result.preset}\n`,
  );
}

runCliIfMain(import.meta.url, runBackgroundCli);
