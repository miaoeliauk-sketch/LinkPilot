import { detectBannedPhrases, compilePhraseList } from "./rules/banned-phrases.js";
import { detectParallelism } from "./rules/parallelism.js";
import { segmentSentences } from "./segment.js";
import type {
  BannedPhraseList,
  L1Report,
  SentenceHit,
  SentenceResult,
  Thresholds,
} from "./types.js";

export interface AnalyzeOptions {
  phrases: BannedPhraseList;
  thresholds: Thresholds;
}

/**
 * L1 规则层：纯确定性计算，不联网、不调模型。
 * 这是工具的兜底能力，也是回归测试的基础——同一段文本必须永远得到同一份报告。
 */
export function analyzeL1(text: string, options: AnalyzeOptions): L1Report {
  const { phrases, thresholds } = options;
  const compiled = compilePhraseList(phrases);
  const sentences = segmentSentences(text);

  const results: SentenceResult[] = sentences.map((sentence) => {
    const hits: SentenceHit[] = [
      ...detectBannedPhrases(sentence.text, compiled),
      ...detectParallelism(sentence.text, thresholds),
    ];

    if (sentence.charCount > thresholds.maxSentenceLength) {
      hits.push({
        rule: "overlong-sentence",
        detail: `本句 ${sentence.charCount} 字，超过最长句阈值 ${thresholds.maxSentenceLength} 字`,
      });
    }

    return { ...sentence, hits };
  });

  const totalCharCount = results.reduce(
    (sum, sentence) => sum + sentence.charCount,
    0,
  );
  const maxSentenceLength = results.reduce(
    (longest, sentence) => Math.max(longest, sentence.charCount),
    0,
  );
  const averageSentenceLength =
    results.length === 0
      ? 0
      : Math.round((totalCharCount / results.length) * 10) / 10;

  const countRule = (rule: SentenceHit["rule"]) =>
    results.reduce(
      (sum, sentence) =>
        sum + sentence.hits.filter((hit) => hit.rule === rule).length,
      0,
    );

  const warnings: string[] = [];
  if (averageSentenceLength > thresholds.averageSentenceLength) {
    warnings.push(
      `平均句长 ${averageSentenceLength} 字，超过阈值 ${thresholds.averageSentenceLength} 字`,
    );
  }
  if (maxSentenceLength > thresholds.maxSentenceLength) {
    warnings.push(
      `最长句 ${maxSentenceLength} 字，超过阈值 ${thresholds.maxSentenceLength} 字`,
    );
  }

  return {
    configVersion: {
      phrases: phrases.version,
      thresholds: thresholds.version,
    },
    metrics: {
      sentenceCount: results.length,
      totalCharCount,
      averageSentenceLength,
      maxSentenceLength,
      bannedPhraseHitCount: countRule("banned-phrase"),
      parallelismHitCount: countRule("parallelism"),
      overlongSentenceCount: countRule("overlong-sentence"),
    },
    warnings,
    sentences: results,
  };
}
