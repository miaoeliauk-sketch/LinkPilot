import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseOptionPairs, runCliIfMain } from "../cli-utils.js";
import { loadBannedPhrases, loadThresholds } from "./config.js";
import { analyzeL1 } from "./l1.js";
import { formatReport } from "./report.js";

function usage() {
  return [
    "用法：",
    "  pnpm diagnose -- --input <口播稿.txt>",
    "  cat 口播稿.txt | pnpm diagnose",
    "可选：--json <报告输出路径> --phrases <词表JSON> --thresholds <阈值JSON>",
    "",
    "说明：本工具做的是「听起来像不像人说话」的风格诊断，",
    "不判定文本是否由某个模型生成，不要当作 AI 生成检测工具使用。",
  ].join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runDiagnoseCli(argumentsList = process.argv.slice(2)) {
  const normalized = argumentsList.filter((argument) => argument !== "--");
  const values = parseOptionPairs(normalized, usage());

  const inputPath = values.get("--input");
  const text = inputPath
    ? await readFile(resolve(inputPath), "utf8")
    : await readStdin();

  if (!text.trim()) {
    throw new Error(
      inputPath ? `输入文件是空的：${resolve(inputPath)}` : usage(),
    );
  }

  const phrasesPath = values.get("--phrases");
  const thresholdsPath = values.get("--thresholds");
  const [phrases, thresholds] = await Promise.all([
    loadBannedPhrases(phrasesPath ? resolve(phrasesPath) : undefined),
    loadThresholds(thresholdsPath ? resolve(thresholdsPath) : undefined),
  ]);

  const report = analyzeL1(text, { phrases, thresholds });

  const jsonPath = values.get("--json");
  if (jsonPath) {
    const target = resolve(jsonPath);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`报告已写入：${target}\n`);
  }

  process.stdout.write(formatReport(report));
}

runCliIfMain(import.meta.url, runDiagnoseCli);
