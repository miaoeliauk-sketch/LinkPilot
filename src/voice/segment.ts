import type { Sentence } from "./types.js";

/** 句子终止符。逗号和分号不切句——口播稿里它们是气口，不是句界。 */
const TERMINATORS = new Set(["。", "！", "？", "!", "?", "…"]);

/** 标点、符号、空白都不计入字数 */
const NON_COUNTING = /[\p{P}\p{S}\s]/u;

export function countChars(text: string): number {
  let count = 0;
  for (const character of text) {
    if (!NON_COUNTING.test(character)) {
      count += 1;
    }
  }
  return count;
}

/**
 * 按句号/问号/感叹号/换行切句，保留每句在原文中的偏移量。
 * 偏移量是后续把模型返回的引用回标到原文的依据，不能丢。
 */
export function segmentSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let cursor = 0;

  const push = (start: number, end: number) => {
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }
    const offset = start + (raw.length - raw.trimStart().length);
    sentences.push({
      index: sentences.length,
      text: trimmed,
      start: offset,
      end: offset + trimmed.length,
      charCount: countChars(trimmed),
    });
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;

    if (TERMINATORS.has(character)) {
      // 连续终止符（？！ 或 ……）归入同一句
      let end = index + 1;
      while (end < text.length && TERMINATORS.has(text[end]!)) {
        end += 1;
      }
      push(cursor, end);
      cursor = end;
      index = end - 1;
      continue;
    }

    if (character === "\n") {
      push(cursor, index);
      cursor = index + 1;
    }
  }

  push(cursor, text.length);
  return sentences;
}
