import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeDecorations } from "../src/composite.js";
import { defaultDecorations } from "../src/defaults.js";

describe("default Day 4 decorations", () => {
  it("ships seal, cloud and tape PNG assets that can be composed together", async () => {
    const decorations = defaultDecorations();
    expect(decorations.map((decoration) => decoration.id)).toEqual([
      "seal",
      "cloud",
      "tape",
    ]);

    await Promise.all(decorations.map((decoration) => access(decoration.path)));

    const directory = await mkdtemp(join(tmpdir(), "inkpilot-defaults-"));
    const inputPath = join(directory, "input.png");
    const outputPath = join(directory, "output.png");

    await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(inputPath);

    const result = await composeDecorations({
      inputPath,
      outputPath,
      decorations,
    });

    expect(result.placements).toHaveLength(3);
    expect(new Set(result.placements.map((item) => item.anchor)).size).toBe(3);
    expect((await sharp(outputPath).metadata()).hasAlpha).toBe(true);
  });
});
