import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { composeDecorations } from "./composite.js";
import { defaultDecorations } from "./defaults.js";
import { ANCHORS, type DecorationSpec } from "./types.js";

interface CliArguments {
  inputPath: string;
  outputPath: string;
  manifestPath?: string;
}

function usage() {
  return [
    "用法：",
    "  pnpm compose -- --input <透明PNG> --output <输出PNG>",
    "  pnpm compose -- --input <透明PNG> --output <输出PNG> --manifest <配置JSON>",
  ].join("\n");
}

function parseArguments(argumentsList: string[]): CliArguments {
  const normalizedArguments = argumentsList.filter(
    (argument) => argument !== "--",
  );
  const values = new Map<string, string>();

  for (let index = 0; index < normalizedArguments.length; index += 2) {
    const key = normalizedArguments[index];
    const value = normalizedArguments[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(usage());
    }
    values.set(key, value);
  }

  const inputPath = values.get("--input");
  const outputPath = values.get("--output");
  if (!inputPath || !outputPath) {
    throw new Error(usage());
  }

  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    manifestPath: values.get("--manifest")
      ? resolve(values.get("--manifest")!)
      : undefined,
  };
}

function isDecorationSpec(value: unknown): value is DecorationSpec {
  if (!value || typeof value !== "object") {
    return false;
  }

  const decoration = value as Record<string, unknown>;
  const preferredAnchorsAreValid =
    decoration.preferredAnchors === undefined ||
    (Array.isArray(decoration.preferredAnchors) &&
      decoration.preferredAnchors.every(
        (anchor) =>
          typeof anchor === "string" &&
          ANCHORS.includes(anchor as (typeof ANCHORS)[number]),
      ));

  return (
    typeof decoration.id === "string" &&
    typeof decoration.path === "string" &&
    typeof decoration.widthRatio === "number" &&
    typeof decoration.opacity === "number" &&
    typeof decoration.marginRatio === "number" &&
    preferredAnchorsAreValid
  );
}

async function loadManifest(manifestPath: string): Promise<DecorationSpec[]> {
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
    decorations?: unknown;
  };
  if (
    !Array.isArray(raw.decorations) ||
    !raw.decorations.every(isDecorationSpec)
  ) {
    throw new Error("装饰配置格式不正确");
  }

  const manifestDirectory = dirname(manifestPath);
  return raw.decorations.map((decoration) => ({
    ...decoration,
    path: isAbsolute(decoration.path)
      ? decoration.path
      : resolve(manifestDirectory, decoration.path),
  }));
}

export async function runCli(argumentsList = process.argv.slice(2)) {
  const arguments_ = parseArguments(argumentsList);
  const decorations = arguments_.manifestPath
    ? await loadManifest(arguments_.manifestPath)
    : defaultDecorations();

  const result = await composeDecorations({
    inputPath: arguments_.inputPath,
    outputPath: arguments_.outputPath,
    decorations,
  });

  process.stdout.write(
    `已生成：${arguments_.outputPath}\n画布：${result.width}×${result.height}，装饰：${result.placements.length}个，跳过：${result.skipped.length}个\n`,
  );
}

const entryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";

if (entryPath === import.meta.url) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
