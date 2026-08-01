import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("InkPilot command line", () => {
  it("composes an input PNG with a JSON decoration manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-cli-"));
    const inputPath = join(directory, "input.png");
    const decorationPath = join(directory, "seal.png");
    const manifestPath = join(directory, "decorations.json");
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

    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 194, g: 53, b: 49, alpha: 1 },
      },
    })
      .png()
      .toFile(decorationPath);

    await writeFile(
      manifestPath,
      JSON.stringify({
        decorations: [
          {
            id: "seal",
            path: decorationPath,
            widthRatio: 0.25,
            opacity: 0.8,
            marginRatio: 0.0625,
          },
        ],
      }),
    );

    const { stdout } = await execFileAsync(
      "pnpm",
      [
        "compose",
        "--",
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--manifest",
        manifestPath,
        "--source-type",
        "ai",
        "--records-dir",
        recordsDirectory,
      ],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("已生成");
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
    expect(metadata.hasAlpha).toBe(true);

    const recordFiles = await readdir(recordsDirectory);
    expect(recordFiles).toHaveLength(1);
    const record = JSON.parse(
      await readFile(join(recordsDirectory, recordFiles[0]!), "utf8"),
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      input_image: inputPath,
      source_type: "AI测试素材",
      output_image: outputPath,
      human_review: "待定",
      params: {
        操作: "装饰合成",
        模型版本: "sharp",
      },
    });
    expect(Object.keys(record).sort()).toEqual([
      "human_review",
      "input_image",
      "output_image",
      "params",
      "source_type",
      "timestamp",
    ]);
    expect(record.timestamp).toEqual(expect.any(String));
  });

  it("rejects an unknown preferred anchor in a JSON manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-cli-invalid-"));
    const manifestPath = join(directory, "decorations.json");

    await writeFile(
      manifestPath,
      JSON.stringify({
        decorations: [
          {
            id: "seal",
            path: "./seal.png",
            widthRatio: 0.14,
            opacity: 0.9,
            marginRatio: 0.04,
            preferredAnchors: ["center"],
          },
        ],
      }),
    );

    await expect(
      execFileAsync(
        "pnpm",
        [
          "compose",
          "--",
          "--input",
          join(directory, "input.png"),
          "--output",
          join(directory, "output.png"),
          "--manifest",
          manifestPath,
          "--source-type",
          "ai",
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("装饰配置格式不正确"),
    });
  });

  it("checks the records directory before creating an output image", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "inkpilot-cli-records-unavailable-"),
    );
    const inputPath = join(directory, "input.png");
    const outputPath = join(directory, "output.png");
    const unusableRecordsPath = join(directory, "records-file");
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
    await writeFile(unusableRecordsPath, "not a directory");

    await expect(
      execFileAsync(
        "pnpm",
        [
          "compose",
          "--",
          "--input",
          inputPath,
          "--output",
          outputPath,
          "--source-type",
          "ai",
          "--records-dir",
          unusableRecordsPath,
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("记录目录不可用"),
    });
    await expect(access(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
