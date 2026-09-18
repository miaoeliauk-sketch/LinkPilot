import { describe, expect, it } from "vitest";
import { countChars, segmentSentences } from "../src/voice/segment.js";

describe("VoicePilot 切句", () => {
  it("按句号/问号/感叹号/换行切句，并保留原文偏移量", () => {
    const text = "八点半到。摊子刚支开！你猜怎么着？\n我蹲了半小时。";
    const sentences = segmentSentences(text);

    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "八点半到。",
      "摊子刚支开！",
      "你猜怎么着？",
      "我蹲了半小时。",
    ]);

    for (const sentence of sentences) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });

  it("逗号和分号不切句——口播稿里它们是气口，不是句界", () => {
    const sentences = segmentSentences("不吵闹，不张扬；也不刻意。");
    expect(sentences).toHaveLength(1);
  });

  it("连续终止符归入同一句", () => {
    const sentences = segmentSentences("真的吗？！我不信……");
    expect(sentences.map((sentence) => sentence.text)).toEqual([
      "真的吗？！",
      "我不信……",
    ]);
  });

  it("字数不计标点和空白", () => {
    expect(countChars("老板要三十，我给了二十五。")).toBe(11);
    expect(countChars("翻到一本《美术》")).toBe(6);
  });
});
