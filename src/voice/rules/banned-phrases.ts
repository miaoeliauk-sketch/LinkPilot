import type { BannedPhraseList, SentenceHit } from "../types.js";

/** 通配符匹配的内容不跨句，且最多 12 字——放宽会把不相干的两句话连起来误报 */
const WILDCARD_PATTERN = "[^。！？!?…\\n]{1,12}?";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compilePhrase(phrase: string, wildcard: string): RegExp {
  const segments = phrase.split(wildcard).map(escapeRegExp);
  return new RegExp(segments.join(WILDCARD_PATTERN));
}

export interface CompiledPhrase {
  category: string;
  phrase: string;
  pattern: RegExp;
}

export function compilePhraseList(list: BannedPhraseList): CompiledPhrase[] {
  return list.groups.flatMap((group) =>
    group.phrases.map((phrase) => ({
      category: group.category,
      phrase,
      pattern: compilePhrase(phrase, list.wildcard),
    })),
  );
}

export function detectBannedPhrases(
  sentenceText: string,
  compiled: CompiledPhrase[],
): SentenceHit[] {
  const hits: SentenceHit[] = [];

  for (const entry of compiled) {
    const match = entry.pattern.exec(sentenceText);
    if (!match) {
      continue;
    }
    hits.push({
      rule: "banned-phrase",
      category: entry.category,
      detail:
        match[0] === entry.phrase
          ? `指纹词「${entry.phrase}」`
          : `指纹句式「${entry.phrase}」，实际命中「${match[0]}」`,
    });
  }

  return hits;
}
