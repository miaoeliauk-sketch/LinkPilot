import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeBackground } from "../src/background.js";

async function createLayeredFixture() {
  const directory = await mkdtemp(join(tmpdir(), "inkpilot-background-"));
  const inputPath = join(directory, "subject-with-decoration.png");
  const outputPath = join(directory, "output.png");

  const subject = await sharp({
    create: {
      width: 24,
      height: 32,
      channels: 4,
      background: { r: 46, g: 64, b: 87, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const decoration = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 194, g: 53, b: 49, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: subject, left: 20, top: 16 },
      { input: decoration, left: 4, top: 4 },
    ])
    .png()
    .toFile(inputPath);

  return { inputPath, outputPath };
}

function pixelAt(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
) {
  const index = (y * width + x) * 4;
  return [...pixels.subarray(index, index + 4)];
}

describe("composeBackground", () => {
  it("places the grid background below subject and decoration without changing the input file", async () => {
    const fixture = await createLayeredFixture();
    const originalFile = await readFile(fixture.inputPath);

    await composeBackground({
      inputPath: fixture.inputPath,
      outputPath: fixture.outputPath,
      preset: "grid",
    });

    const output = await sharp(fixture.outputPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(output.info.width).toBe(64);
    expect(output.info.height).toBe(64);
    expect(pixelAt(output.data, 64, 24, 24)).toEqual([46, 64, 87, 255]);
    expect(pixelAt(output.data, 64, 6, 6)).toEqual([194, 53, 49, 255]);
    expect(pixelAt(output.data, 64, 60, 60)[3]).toBe(255);
    expect(await readFile(fixture.inputPath)).toEqual(originalFile);
  });

  it("switches freely between transparent, grid and xuan-paper backgrounds", async () => {
    const fixture = await createLayeredFixture();
    const nonePath = join(dirname(fixture.outputPath), "none.png");
    const gridPath = join(dirname(fixture.outputPath), "grid.png");
    const xuanPath = join(dirname(fixture.outputPath), "xuan-paper.png");

    await composeBackground({
      inputPath: fixture.inputPath,
      outputPath: nonePath,
      preset: "none",
    });
    await composeBackground({
      inputPath: fixture.inputPath,
      outputPath: gridPath,
      preset: "grid",
    });
    await composeBackground({
      inputPath: fixture.inputPath,
      outputPath: xuanPath,
      preset: "xuan-paper",
    });

    const none = await sharp(nonePath).ensureAlpha().raw().toBuffer();
    const grid = await sharp(gridPath).ensureAlpha().raw().toBuffer();
    const xuan = await sharp(xuanPath).ensureAlpha().raw().toBuffer();
    const cornerAlphaIndex = ((63 * 64 + 63) * 4) + 3;

    expect(none[cornerAlphaIndex]).toBe(0);
    expect(grid[cornerAlphaIndex]).toBe(255);
    expect(xuan[cornerAlphaIndex]).toBe(255);
    expect(grid.equals(xuan)).toBe(false);
  });

  it("refuses to overwrite the original transparent input", async () => {
    const fixture = await createLayeredFixture();

    await expect(
      composeBackground({
        inputPath: fixture.inputPath,
        outputPath: fixture.inputPath,
        preset: "grid",
      }),
    ).rejects.toThrow("输出路径不能覆盖原始透明图");
  });
});
