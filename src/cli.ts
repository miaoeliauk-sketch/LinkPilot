import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { parseOptionPairs, runCliIfMain } from "./cli-utils.js";
import { composeDecorations } from "./composite.js";
import {
  decorationPathForAsset,
  defaultDecorations,
} from "./defaults.js";
import {
  SOURCE_TYPE_OPTIONS,
  sourceTypeFromOption,
  writeGenerationRecord,
  type SourceTypeOption,
} from "./metadata.js";
import {
  ANCHORS,
  DECORATION_ASSET_IDS,
  type DecorationAssetId,
  type DecorationSpec,
} from "./types.js";

interface CliArguments {
  inputPath: string;
  outputPath: string;
  manifestPath?: string;
  sourceType: SourceTypeOption;
  recordsDirectory?: string;
}

function usage() {
  return [
    "用法：",
    "  pnpm compose -- --input <透明PNG> --output <输出PNG>",
    "  pnpm compose -- --input <透明PNG> --output <输出PNG> --manifest <配置JSON>",
    "必填：--source-type <real|ai>；可选：--records-dir <记录目录>",
  ].join("\n");
}

function parseArguments(argumentsList: string[]): CliArguments {
  const values = parseOptionPairs(argumentsList, usage());

  const inputPath = values.get("--input");
  const outputPath = values.get("--output");
  const sourceType = values.get("--source-type");
  if (
    !inputPath ||
    !outputPath ||
    !sourceType ||
    !SOURCE_TYPE_OPTIONS.includes(sourceType as SourceTypeOption)
  ) {
    throw new Error(usage());
  }

  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    manifestPath: values.get("--manifest")
      ? resolve(values.get("--manifest")!)
      : undefined,
    sourceType: sourceType as SourceTypeOption,
    recordsDirectory: values.get("--records-dir")
      ? resolve(values.get("--records-dir")!)
      : undefined,
  };
}

interface ManifestDecoration extends Omit<DecorationSpec, "path"> {
  path?: string;
  asset?: DecorationAssetId;
}

function isDecorationSpec(value: unknown): value is ManifestDecoration {
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
  const assetIsValid =
    decoration.asset === undefined ||
    (typeof decoration.asset === "string" &&
      DECORATION_ASSET_IDS.includes(
        decoration.asset as DecorationAssetId,
      ));
  const hasOneAssetSource =
    (typeof decoration.path === "string") !==
    (typeof decoration.asset === "string");

  return (
    typeof decoration.id === "string" &&
    typeof decoration.widthRatio === "number" &&
    typeof decoration.opacity === "number" &&
    typeof decoration.marginRatio === "number" &&
    preferredAnchorsAreValid &&
    assetIsValid &&
    hasOneAssetSource
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
    id: decoration.id,
    path: decoration.asset
      ? decorationPathForAsset(decoration.asset)
      : isAbsolute(decoration.path!)
        ? decoration.path!
        : resolve(manifestDirectory, decoration.path!),
    widthRatio: decoration.widthRatio,
    opacity: decoration.opacity,
    marginRatio: decoration.marginRatio,
    preferredAnchors: decoration.preferredAnchors,
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
  const recordPath = await writeGenerationRecord({
    inputImage: arguments_.inputPath,
    sourceType: sourceTypeFromOption(arguments_.sourceType),
    params: {
      操作: "装饰合成",
      国风强度: "未指定",
      模型版本: "sharp",
      prompt: "",
      装饰数量: result.placements.length,
      跳过数量: result.skipped.length,
    },
    outputImage: arguments_.outputPath,
    recordsDirectory: arguments_.recordsDirectory,
  });

  process.stdout.write(
    `已生成：${arguments_.outputPath}\n记录：${recordPath}\n画布：${result.width}×${result.height}，装饰：${result.placements.length}个，跳过：${result.skipped.length}个\n`,
  );
}

runCliIfMain(import.meta.url, runCli);
