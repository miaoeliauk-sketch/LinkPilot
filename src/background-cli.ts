import { resolve } from "node:path";
import { parseOptionPairs, runCliIfMain } from "./cli-utils.js";
import {
  BACKGROUND_PRESETS,
  composeBackground,
  type BackgroundPreset,
} from "./background.js";

function usage() {
  return [
    "用法：",
    "  pnpm background -- --input <透明PNG> --output <输出PNG> --preset <none|grid|xuan-paper>",
  ].join("\n");
}

function parseArguments(argumentsList: string[]) {
  const values = parseOptionPairs(argumentsList, usage());

  const inputPath = values.get("--input");
  const outputPath = values.get("--output");
  const preset = values.get("--preset");
  if (
    !inputPath ||
    !outputPath ||
    !preset ||
    !BACKGROUND_PRESETS.includes(preset as BackgroundPreset)
  ) {
    throw new Error(usage());
  }

  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    preset: preset as BackgroundPreset,
  };
}

export async function runBackgroundCli(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  const result = await composeBackground(options);
  process.stdout.write(
    `已生成：${options.outputPath}\n画布：${result.width}×${result.height}，背景：${result.preset}\n`,
  );
}

runCliIfMain(import.meta.url, runBackgroundCli);
