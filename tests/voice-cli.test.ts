import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const AI_SCRIPT = [
  "你有没有发现，好的设计都很安静。",
  "它不吵闹，不张扬，不刻意。",
  "这种细腻的体验，值得你慢慢感受。",
].join("");

describe("VoicePilot diagnose command", () => {
  it("从文件读稿，输出指标并可写出 JSON 报告", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voicepilot-diagnose-"));
    const inputPath = join(directory, "script.txt");
    const reportPath = join(directory, "report.json");
    await writeFile(inputPath, AI_SCRIPT, "utf8");

    const { stdout } = await execFileAsync(
      "pnpm",
      ["diagnose", "--", "--input", inputPath, "--json", reportPath],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("指纹词命中：");
    expect(stdout).toContain("你有没有发现");
    expect(stdout).toContain("三档标注");

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.metrics.sentenceCount).toBe(3);
    expect(report.metrics.bannedPhraseHitCount).toBeGreaterThanOrEqual(2);
    expect(report.metrics.parallelismHitCount).toBeGreaterThanOrEqual(1);
    expect(report.configVersion.phrases).toBe("banned-phrases-v0");
  });

  it("没有 --input 时从标准输入读稿", () => {
    const stdout = execFileSync("pnpm", ["diagnose"], {
      cwd: process.cwd(),
      input: AI_SCRIPT,
      encoding: "utf8",
    });

    expect(stdout).toContain("句数：3");
  });

  it("词表换成自定义文件即可改变命中，不用改代码", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voicepilot-phrases-"));
    const inputPath = join(directory, "script.txt");
    const phrasesPath = join(directory, "phrases.json");
    await writeFile(inputPath, "这个摊子八点半支开。", "utf8");
    await writeFile(
      phrasesPath,
      JSON.stringify({
        version: "banned-phrases-test",
        wildcard: "XX",
        groups: [{ category: "测试类", phrases: ["八点半"] }],
      }),
      "utf8",
    );

    const { stdout } = await execFileAsync(
      "pnpm",
      ["diagnose", "--", "--input", inputPath, "--phrases", phrasesPath],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("banned-phrases-test");
    expect(stdout).toContain("指纹词命中：1");
  });

  it("词表格式不对时报错并指出文件路径", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voicepilot-bad-phrases-"));
    const inputPath = join(directory, "script.txt");
    const phrasesPath = join(directory, "phrases.json");
    await writeFile(inputPath, "随便一句话。", "utf8");
    await writeFile(phrasesPath, JSON.stringify({ groups: [] }), "utf8");

    await expect(
      execFileAsync(
        "pnpm",
        ["diagnose", "--", "--input", inputPath, "--phrases", phrasesPath],
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/version/);
  });
});
