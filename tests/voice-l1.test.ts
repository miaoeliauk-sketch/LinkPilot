import { describe, expect, it } from "vitest";
import { loadBannedPhrases, loadThresholds } from "../src/voice/config.js";
import { analyzeL1 } from "../src/voice/l1.js";
import type { RuleId } from "../src/voice/types.js";

const phrases = await loadBannedPhrases();
const thresholds = await loadThresholds();

function analyze(text: string) {
  return analyzeL1(text, { phrases, thresholds });
}

function rulesOf(text: string, sentenceIndex: number): RuleId[] {
  return analyze(text).sentences[sentenceIndex]!.hits.map((hit) => hit.rule);
}

describe("VoicePilot L1 规则层", () => {
  it("命中指纹词并标出所属分类", () => {
    const report = analyze("你有没有发现，好的设计都很安静。");
    const hit = report.sentences[0]!.hits[0]!;

    expect(hit.rule).toBe("banned-phrase");
    expect(hit.category).toBe("开头类");
    expect(hit.detail).toContain("你有没有发现");
  });

  it("带 XX 通配的指纹句式能命中并回报实际命中的文字", () => {
    const report = analyze("真正的质感从来都不是靠堆砌。");
    const hit = report.sentences[0]!.hits.find(
      (candidate) => candidate.category === "句式类",
    )!;

    expect(hit.detail).toContain("真正的XX从来都不是");
    expect(hit.detail).toContain("真正的质感从来都不是");
  });

  it("通配符不跨句，不会把相邻两句连成一次命中", () => {
    const report = analyze("这不是重点。而是另一回事。");
    expect(report.metrics.bannedPhraseHitCount).toBe(0);
  });

  it("命中三连排比：连续短句同一个字开头", () => {
    expect(rulesOf("它不吵闹，不张扬，不刻意。", 0)).toContain("parallelism");
  });

  it("命中三连排比：连续短句都以「的」结尾", () => {
    const report = analyze("那是慢的，静的，旧的。");
    expect(report.sentences[0]!.hits[0]!.detail).toContain("以「的」结尾");
  });

  it("只有两个并列短句不算排比", () => {
    expect(rulesOf("不吵闹，不张扬。", 0)).not.toContain("parallelism");
  });

  it("超长句逐句标出，平均句长超阈值给全文级告警", () => {
    const longSentence =
      "这个东西真正打动我的地方在于它把很多看起来互不相干的细节全部收拢到了同一个节奏里面。";
    const report = analyze(longSentence);

    expect(report.metrics.overlongSentenceCount).toBe(1);
    expect(report.warnings.join("")).toContain("最长句");
    expect(report.warnings.join("")).toContain("平均句长");
  });

  it("人写的口语稿零命中零告警", () => {
    const humanScript = [
      "上周我去了趟潘家园。",
      "八点半到，摊子刚支开。",
      "我蹲在一个卖旧书的摊前翻了半小时，翻到一本一九八二年的《美术》。",
      "老板要三十，我给了二十五。",
    ].join("");
    const report = analyze(humanScript);

    expect(report.metrics.sentenceCount).toBe(4);
    expect(report.sentences.flatMap((sentence) => sentence.hits)).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("同一段文本跑两次结果完全一致", () => {
    const text = "你有没有发现，它不吵闹，不张扬，不刻意。";
    expect(analyze(text)).toEqual(analyze(text));
  });

  it("报告带上配置版本号", () => {
    const report = analyze("随便一句话。");
    expect(report.configVersion.phrases).toBe(phrases.version);
    expect(report.configVersion.thresholds).toBe(thresholds.version);
  });
});
