import { countChars } from "../segment.js";
import type { SentenceHit, Thresholds } from "../types.js";

const CLAUSE_SEPARATOR = /[，,、；;]/;

/** 句尾的终止符要剥掉，否则末尾分句的"的"被句号挡住，整串排比就漏了 */
const TRAILING_TERMINATOR = /[。！？!?…]+$/u;

function splitClauses(sentenceText: string): string[] {
  return sentenceText
    .split(CLAUSE_SEPARATOR)
    .map((clause) => clause.trim().replace(TRAILING_TERMINATOR, ""))
    .filter(Boolean);
}

function firstCharacter(clause: string): string {
  return [...clause][0] ?? "";
}

/**
 * 排比的第一个分句常常带一个主语（"它不吵闹，不张扬，不刻意"），
 * 主语会把本该连起来的三连打断。取首字前先剥掉主语，否则这类最典型的排比反而漏报。
 */
const LEADING_SUBJECT = /^(它们|他们|她们|我们|你们|它|他|她|我|你|这|那)(是)?/;

function alignedFirstCharacter(clause: string): string {
  const stripped = clause.replace(LEADING_SUBJECT, "");
  return firstCharacter(stripped || clause);
}

/** 找出连续满足 connected 的片段，长度达到 minimumRun 才算一处排比 */
function findRuns(
  clauses: string[],
  connected: (previous: string, current: string) => boolean,
  minimumRun: number,
): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];

  for (const clause of clauses) {
    if (current.length === 0) {
      current = [clause];
      continue;
    }
    if (connected(current[current.length - 1]!, clause)) {
      current.push(clause);
      continue;
    }
    if (current.length >= minimumRun) {
      runs.push(current);
    }
    current = [clause];
  }

  if (current.length >= minimumRun) {
    runs.push(current);
  }

  return runs;
}

/**
 * 三连排比检测。只在短片段上判定——长句里偶然共用结尾或开头是正常表达，
 * 按排比报出来就是误报，而误报是这个工具的生死线。
 */
export function detectParallelism(
  sentenceText: string,
  thresholds: Thresholds,
): SentenceHit[] {
  const clauses = splitClauses(sentenceText);
  const isShort = (clause: string) =>
    countChars(clause) <= thresholds.maxParallelClauseChars;
  const hits: SentenceHit[] = [];

  const endingRuns = findRuns(
    clauses,
    (previous, current) =>
      previous.endsWith("的") &&
      current.endsWith("的") &&
      isShort(previous) &&
      isShort(current),
    thresholds.minParallelClauseRun,
  );
  for (const run of endingRuns) {
    hits.push({
      rule: "parallelism",
      detail: `连续 ${run.length} 个短句以「的」结尾：${run.join("／")}`,
    });
  }

  const openingRuns = findRuns(
    clauses,
    (previous, current) =>
      alignedFirstCharacter(previous) === alignedFirstCharacter(current) &&
      alignedFirstCharacter(current) !== "" &&
      isShort(previous) &&
      isShort(current),
    thresholds.minParallelClauseRun,
  );
  for (const run of openingRuns) {
    hits.push({
      rule: "parallelism",
      detail: `连续 ${run.length} 个短句以「${alignedFirstCharacter(run[0]!)}」开头：${run.join("／")}`,
    });
  }

  return hits;
}
