export interface Sentence {
  index: number;
  /** 去掉首尾空白后的原文片段，含句尾标点 */
  text: string;
  /** 在原文中的起始偏移，用于把命中回标到原文位置 */
  start: number;
  /** 在原文中的结束偏移（不含） */
  end: number;
  /** 计入字数的字符数，不含标点和空白 */
  charCount: number;
}

export type RuleId = "banned-phrase" | "parallelism" | "overlong-sentence";

export interface SentenceHit {
  rule: RuleId;
  /** 命中的具体内容，要能让用户一眼看出问题在哪 */
  detail: string;
  /** 指纹词命中时记录所属分类，其余规则为空 */
  category?: string;
  /** 在句中实际命中的原文片段，界面按它做字级高亮；只有指纹词规则会给 */
  match?: string;
}

export interface SentenceResult extends Sentence {
  hits: SentenceHit[];
}

export interface L1Metrics {
  sentenceCount: number;
  totalCharCount: number;
  averageSentenceLength: number;
  maxSentenceLength: number;
  bannedPhraseHitCount: number;
  parallelismHitCount: number;
  overlongSentenceCount: number;
}

export interface L1Report {
  configVersion: {
    phrases: string;
    thresholds: string;
  };
  metrics: L1Metrics;
  /** 全文级告警（平均句长、最长句超阈值） */
  warnings: string[];
  sentences: SentenceResult[];
}

export interface BannedPhraseGroup {
  category: string;
  phrases: string[];
}

export interface BannedPhraseList {
  version: string;
  wildcard: string;
  groups: BannedPhraseGroup[];
}

export interface Thresholds {
  version: string;
  averageSentenceLength: number;
  maxSentenceLength: number;
  maxParallelClauseChars: number;
  minParallelClauseRun: number;
}
