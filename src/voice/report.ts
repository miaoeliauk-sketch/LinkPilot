import type { L1Report } from "./types.js";

const RULE_LABELS: Record<string, string> = {
  "banned-phrase": "指纹词",
  parallelism: "三连排比",
  "overlong-sentence": "超长句",
};

export function formatReport(report: L1Report): string {
  const { metrics, warnings } = report;
  const lines: string[] = [];

  lines.push(
    `配置版本：${report.configVersion.phrases} / ${report.configVersion.thresholds}`,
  );
  lines.push(`句数：${metrics.sentenceCount}　总字数：${metrics.totalCharCount}`);
  lines.push(
    `平均句长：${metrics.averageSentenceLength} 字　最长句：${metrics.maxSentenceLength} 字`,
  );
  lines.push(
    `指纹词命中：${metrics.bannedPhraseHitCount}　三连排比：${metrics.parallelismHitCount}　超长句：${metrics.overlongSentenceCount}`,
  );

  lines.push("");
  if (warnings.length === 0) {
    lines.push("全文级告警：无");
  } else {
    lines.push("全文级告警：");
    for (const warning of warnings) {
      lines.push(`  · ${warning}`);
    }
  }

  const flagged = report.sentences.filter((sentence) => sentence.hits.length > 0);
  lines.push("");
  if (flagged.length === 0) {
    lines.push("逐句命中：无");
  } else {
    lines.push("逐句命中：");
    for (const sentence of flagged) {
      lines.push(`  #${sentence.index + 1}（原文 ${sentence.start}-${sentence.end}）${sentence.text}`);
      for (const hit of sentence.hits) {
        const label = RULE_LABELS[hit.rule] ?? hit.rule;
        lines.push(`      [${label}] ${hit.detail}`);
      }
    }
  }

  lines.push("");
  lines.push(
    "以上只是 L1 规则层的指标和命中，不是最终结论。三档标注（AI味/存疑/通过）要等 Day 4 的两层合并策略。",
  );

  return `${lines.join("\n")}\n`;
}
