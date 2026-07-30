import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeDecorations } from "../src/composite.js";

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "inkpilot-day4-"));
  const inputPath = join(directory, "input.png");
  const decorationPath = join(directory, "decoration.png");
  const outputPath = join(directory, "output.png");

  const canvas = {
    create: {
      width: 64,
      height: 64,
      channels: 4 as const,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  };

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

  await sharp(canvas)
    .composite([{ input: subject, left: 20, top: 16 }])
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

  return { decorationPath, inputPath, outputPath };
}

describe("composeDecorations", () => {
  it("keeps the canvas size and alpha channel", async () => {
    const fixture = await createFixture();

    await composeDecorations({
      inputPath: fixture.inputPath,
      outputPath: fixture.outputPath,
      decorations: [
        {
          id: "seal",
          path: fixture.decorationPath,
          widthRatio: 0.25,
          opacity: 1,
          marginRatio: 0.0625,
        },
      ],
    });

    const metadata = await sharp(fixture.outputPath).metadata();

    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
    expect(metadata.channels).toBe(4);
    expect(metadata.hasAlpha).toBe(true);
  });

  it("does not change any non-transparent subject pixel", async () => {
    const fixture = await createFixture();
    const before = await sharp(fixture.inputPath).ensureAlpha().raw().toBuffer();

    await composeDecorations({
      inputPath: fixture.inputPath,
      outputPath: fixture.outputPath,
      decorations: [
        {
          id: "seal",
          path: fixture.decorationPath,
          widthRatio: 0.5,
          opacity: 1,
          marginRatio: 0,
        },
      ],
    });

    const after = await sharp(fixture.outputPath).ensureAlpha().raw().toBuffer();

    for (let index = 0; index < before.length; index += 4) {
      if (before[index + 3] > 0) {
        expect(after.subarray(index, index + 4)).toEqual(
          before.subarray(index, index + 4),
        );
      }
    }
  });

  it("keeps decorations inside the configured safe margin", async () => {
    const fixture = await createFixture();

    await composeDecorations({
      inputPath: fixture.inputPath,
      outputPath: fixture.outputPath,
      decorations: [
        {
          id: "seal",
          path: fixture.decorationPath,
          widthRatio: 0.25,
          opacity: 1,
          marginRatio: 0.0625,
        },
      ],
    });

    const { data, info } = await sharp(await readFile(fixture.outputPath))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const edgeAlpha: number[] = [];
    for (let x = 0; x < info.width; x += 1) {
      edgeAlpha.push(data[(x * 4) + 3]);
      edgeAlpha.push(data[(((info.height - 1) * info.width + x) * 4) + 3]);
    }
    for (let y = 0; y < info.height; y += 1) {
      edgeAlpha.push(data[((y * info.width) * 4) + 3]);
      edgeAlpha.push(data[((y * info.width + info.width - 1) * 4) + 3]);
    }

    expect(edgeAlpha.every((alpha) => alpha === 0)).toBe(true);
  });

  it("adds visible decoration pixels to transparent space", async () => {
    const fixture = await createFixture();
    const before = await sharp(fixture.inputPath).ensureAlpha().raw().toBuffer();

    await composeDecorations({
      inputPath: fixture.inputPath,
      outputPath: fixture.outputPath,
      decorations: [
        {
          id: "seal",
          path: fixture.decorationPath,
          widthRatio: 0.25,
          opacity: 0.8,
          marginRatio: 0.0625,
        },
      ],
    });

    const after = await sharp(fixture.outputPath).ensureAlpha().raw().toBuffer();
    let addedPixels = 0;

    for (let index = 0; index < before.length; index += 4) {
      if (before[index + 3] === 0 && after[index + 3] > 0) {
        addedPixels += 1;
      }
    }

    expect(addedPixels).toBe(16 * 16);
  });

  it("skips a decoration instead of cutting it when every corner is occupied", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-blocked-"));
    const inputPath = join(directory, "input.png");
    const decorationPath = join(directory, "decoration.png");
    const outputPath = join(directory, "output.png");

    const corner = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 46, g: 64, b: 87, alpha: 1 },
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
        { input: corner, left: 0, top: 0 },
        { input: corner, left: 48, top: 0 },
        { input: corner, left: 0, top: 48 },
        { input: corner, left: 48, top: 48 },
      ])
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

    const result = await composeDecorations({
      inputPath,
      outputPath,
      decorations: [
        {
          id: "seal",
          path: decorationPath,
          widthRatio: 0.25,
          opacity: 1,
          marginRatio: 0,
        },
      ],
    });

    expect(result.placements).toHaveLength(0);
    expect(result.skipped).toEqual([
      { id: "seal", reason: "没有可完整容纳装饰的空白角落" },
    ]);
    expect(
      await sharp(await readFile(outputPath)).ensureAlpha().raw().toBuffer(),
    ).toEqual(
      await sharp(await readFile(inputPath)).ensureAlpha().raw().toBuffer(),
    );
  });

  it("rejects an input image with no transparent space", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkpilot-opaque-"));
    const inputPath = join(directory, "input.png");
    const outputPath = join(directory, "output.png");

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 46, g: 64, b: 87, alpha: 1 },
      },
    })
      .png()
      .toFile(inputPath);

    await expect(
      composeDecorations({
        inputPath,
        outputPath,
        decorations: [],
      }),
    ).rejects.toThrow("输入图片没有透明区域");
  });
});
