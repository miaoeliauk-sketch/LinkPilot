import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  const normalized = argumentsList.filter((argument) => argument !== "--");
  const values = new Map<string, string>();

  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(usage());
    }
    values.set(key, value);
  }

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

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";

if (entryPath === import.meta.url) {
  runBackgroundCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
