import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("InkPilot background command", () => {
  it("creates a selected background derivative without overwriting the input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-background-cli-"));
    const inputPath = join(directory, "input.png");
    const outputPath = join(directory, "output.png");
    const recordsDirectory = join(directory, "records");

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(inputPath);

    const { stdout } = await execFileAsync(
      "pnpm",
      [
        "background",
        "--",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--preset",
        "xuan-paper",
        "--source-type",
        "real",
        "--records-dir",
        recordsDirectory,
      ],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("背景：xuan-paper");
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
    expect(metadata.hasAlpha).toBe(true);

    const recordFiles = await readdir(recordsDirectory);
    expect(recordFiles).toHaveLength(1);
    const record = JSON.parse(
      await readFile(join(recordsDirectory, recordFiles[0]!), "utf8"),
    );
    expect(record).toMatchObject({
      input_image: inputPath,
      source_type: "实拍",
      output_image: outputPath,
      human_review: "待定",
      params: {
        操作: "背景图层替换与重新合成",
        背景预设: "xuan-paper",
        模型版本: "sharp",
      },
    });
  });
});
