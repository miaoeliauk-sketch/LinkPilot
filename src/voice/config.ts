import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BannedPhraseList, Thresholds } from "./types.js";

const CONFIG_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "config",
);

export const DEFAULT_PHRASES_PATH = join(
  CONFIG_DIRECTORY,
  "banned-phrases.json",
);
export const DEFAULT_THRESHOLDS_PATH = join(
  CONFIG_DIRECTORY,
  "thresholds.json",
);

async function readJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`读不到配置文件：${path}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`配置文件不是合法 JSON：${path}`);
  }
}

export async function loadBannedPhrases(
  path = DEFAULT_PHRASES_PATH,
): Promise<BannedPhraseList> {
  const data = await readJson(path);
  const list = data as Partial<BannedPhraseList>;

  if (
    typeof list.version !== "string" ||
    typeof list.wildcard !== "string" ||
    !Array.isArray(list.groups)
  ) {
    throw new Error(`词表缺少 version / wildcard / groups 字段：${path}`);
  }
  for (const group of list.groups) {
    if (typeof group?.category !== "string" || !Array.isArray(group.phrases)) {
      throw new Error(`词表里有分组缺少 category / phrases 字段：${path}`);
    }
  }

  return list as BannedPhraseList;
}

const NUMERIC_THRESHOLDS = [
  "averageSentenceLength",
  "maxSentenceLength",
  "maxParallelClauseChars",
  "minParallelClauseRun",
] as const;

export async function loadThresholds(
  path = DEFAULT_THRESHOLDS_PATH,
): Promise<Thresholds> {
  const data = await readJson(path);
  const thresholds = data as Partial<Thresholds>;

  if (typeof thresholds.version !== "string") {
    throw new Error(`阈值文件缺少 version 字段：${path}`);
  }
  for (const key of NUMERIC_THRESHOLDS) {
    if (typeof thresholds[key] !== "number") {
      throw new Error(`阈值文件缺少数值字段 ${key}：${path}`);
    }
  }

  return thresholds as Thresholds;
}
