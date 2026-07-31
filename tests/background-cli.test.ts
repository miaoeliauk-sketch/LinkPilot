import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
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
      ],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("背景：xuan-paper");
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
    expect(metadata.hasAlpha).toBe(true);
  });
});
