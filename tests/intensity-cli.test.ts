import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("InkPilot intensity command", () => {
  it("writes a reusable generation plan JSON file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-intensity-cli-"));
    const sourcePath = join(directory, "source.png");
    const outputPath = join(directory, "standard.json");
    const composedPath = join(directory, "composed.png");

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(sourcePath);

    const { stdout } = await execFileAsync(
      "pnpm",
      [
        "intensity",
        "--",
        "--level",
        "standard",
        "--source",
        sourcePath,
        "--subject",
        "短发人物坐在电脑前，保持身份、姿势和电脑轮廓",
        "--mapping",
        "外套映射为黛蓝，内搭映射为月白",
        "--output",
        outputPath,
      ],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("强度：标准");
    const plan = JSON.parse(await readFile(outputPath, "utf8")) as {
      intensity: string;
      label: string;
      sourceImage: string;
      runId: string;
      suggestedOutputName: string;
      prompt: string;
      decorations: Array<{ asset: string; path?: string }>;
    };
    expect(plan.intensity).toBe("standard");
    expect(plan.label).toBe("标准");
    expect(plan.sourceImage).toBe(sourcePath);
    expect(plan.runId).toBe("standard-1");
    expect(plan.suggestedOutputName).toBe("source-inkpilot-standard.png");
    expect(plan.prompt).toContain(
      "#C23531/#2E4057/#F5F0E8/#E8B004/#A0522D",
    );
    expect(plan.decorations).toHaveLength(2);
    expect(plan.decorations.every((item) => item.asset && !item.path)).toBe(
      true,
    );

    await execFileAsync(
      "pnpm",
      [
        "compose",
        "--",
        "--input",
        sourcePath,
        "--output",
        composedPath,
        "--manifest",
        outputPath,
      ],
      { cwd: process.cwd() },
    );

    expect((await sharp(composedPath).metadata()).hasAlpha).toBe(true);
  });

  it("writes one three-run comparison plan for the same source image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-comparison-cli-"));
    const sourcePath = join(directory, "same-source.png");
    const outputPath = join(directory, "comparison.json");

    const { stdout } = await execFileAsync(
      "pnpm",
      [
        "intensity",
        "--",
        "--level",
        "all",
        "--source",
        sourcePath,
        "--subject",
        "同一名短发人物坐在电脑前",
        "--mapping",
        "外套映射为黛蓝，内搭映射为月白",
        "--output",
        outputPath,
      ],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("对比运行：3次");
    const comparison = JSON.parse(await readFile(outputPath, "utf8")) as {
      sourceImage: string;
      runCount: number;
      runs: Array<{ sourceImage: string; intensity: string }>;
    };
    expect(comparison.sourceImage).toBe(sourcePath);
    expect(comparison.runCount).toBe(3);
    expect(comparison.runs.map((run) => run.intensity)).toEqual([
      "light",
      "standard",
      "rich",
    ]);
    expect(
      comparison.runs.every((run) => run.sourceImage === sourcePath),
    ).toBe(true);
  });
});
