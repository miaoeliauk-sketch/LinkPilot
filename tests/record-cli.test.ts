import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("InkPilot generation record command", () => {
  it("records an actual generated image from an intensity plan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-record-cli-"));
    const sourcePath = join(directory, "source.png");
    const outputPath = join(directory, "light.png");
    const planPath = join(directory, "comparison.json");
    const recordsDirectory = join(directory, "records");
    const prompt = "完整的轻度五段式提示词";

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 245, g: 240, b: 232 },
      },
    })
      .png()
      .toFile(sourcePath);
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 46, g: 64, b: 87, alpha: 1 },
      },
    })
      .png()
      .toFile(outputPath);
    await writeFile(
      planPath,
      JSON.stringify({
        sourceImage: sourcePath,
        runCount: 3,
        runs: [
          {
            sourceImage: sourcePath,
            runId: "light-1",
            suggestedOutputName: "source-inkpilot-light.png",
            intensity: "light",
            label: "轻度",
            prompt,
            decorations: [],
          },
        ],
      }),
    );

    const { stdout } = await execFileAsync(
      "pnpm",
      [
        "record",
        "--",
        "--plan",
        planPath,
        "--run-id",
        "light-1",
        "--output",
        outputPath,
        "--source-type",
        "ai",
        "--model",
        "gpt-image-2",
        "--records-dir",
        recordsDirectory,
      ],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("已登记实际结果");
    const recordFiles = await readdir(recordsDirectory);
    expect(recordFiles).toHaveLength(1);
    const record = JSON.parse(
      await readFile(join(recordsDirectory, recordFiles[0]!), "utf8"),
    );
    expect(record).toMatchObject({
      input_image: sourcePath,
      source_type: "AI测试素材",
      output_image: outputPath,
      human_review: "待定",
      params: {
        操作: "AI国风重绘",
        国风强度: "轻度",
        模型版本: "gpt-image-2",
        prompt,
        运行编号: "light-1",
      },
    });
  });

  it("refuses to create a record when the result image does not exist", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "inkpilot-record-cli-missing-"),
    );
    const sourcePath = join(directory, "source.png");
    const planPath = join(directory, "plan.json");
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 245, g: 240, b: 232 },
      },
    })
      .png()
      .toFile(sourcePath);
    await writeFile(
      planPath,
      JSON.stringify({
        sourceImage: sourcePath,
        runId: "standard-1",
        suggestedOutputName: "source-inkpilot-standard.png",
        intensity: "standard",
        label: "标准",
        prompt: "完整提示词",
        decorations: [],
      }),
    );

    await expect(
      execFileAsync(
        "pnpm",
        [
          "record",
          "--",
          "--plan",
          planPath,
          "--run-id",
          "standard-1",
          "--output",
          join(directory, "missing.png"),
          "--source-type",
          "ai",
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("实际结果图片不可用"),
    });
    await expect(readdir(join(directory, "records"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to record a non-image output", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "inkpilot-record-cli-non-image-"),
    );
    const sourcePath = join(directory, "source.png");
    const outputPath = join(directory, "not-image.txt");
    const planPath = join(directory, "plan.json");
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 245, g: 240, b: 232 },
      },
    })
      .png()
      .toFile(sourcePath);
    await writeFile(outputPath, "not an image");
    await writeFile(
      planPath,
      JSON.stringify({
        sourceImage: sourcePath,
        runId: "rich-1",
        suggestedOutputName: "source-inkpilot-rich.png",
        intensity: "rich",
        label: "浓郁",
        prompt: "完整提示词",
        decorations: [],
      }),
    );

    await expect(
      execFileAsync(
        "pnpm",
        [
          "record",
          "--",
          "--plan",
          planPath,
          "--run-id",
          "rich-1",
          "--output",
          outputPath,
          "--source-type",
          "ai",
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("实际结果图片不可用"),
    });
  });

  it("refuses to record a plan whose source image is missing", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "inkpilot-record-cli-missing-source-"),
    );
    const outputPath = join(directory, "output.png");
    const planPath = join(directory, "plan.json");
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 46, g: 64, b: 87 },
      },
    })
      .png()
      .toFile(outputPath);
    await writeFile(
      planPath,
      JSON.stringify({
        sourceImage: join(directory, "missing-source.png"),
        runId: "standard-1",
        suggestedOutputName: "source-inkpilot-standard.png",
        intensity: "standard",
        label: "标准",
        prompt: "完整提示词",
        decorations: [],
      }),
    );

    await expect(
      execFileAsync(
        "pnpm",
        [
          "record",
          "--",
          "--plan",
          planPath,
          "--run-id",
          "standard-1",
          "--output",
          outputPath,
          "--source-type",
          "ai",
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("原图不可用"),
    });
  });
});
