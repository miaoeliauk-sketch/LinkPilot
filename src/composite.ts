import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import type {
  Anchor,
  ComposeDecorationsOptions,
  ComposeDecorationsResult,
  DecorationPlacement,
  DecorationSpec,
} from "./types.js";

const DEFAULT_ANCHORS: Anchor[] = [
  "bottom-right",
  "top-right",
  "top-left",
  "bottom-left",
];

function validateDecoration(decoration: DecorationSpec) {
  if (decoration.widthRatio <= 0 || decoration.widthRatio > 1) {
    throw new Error(`${decoration.id}: widthRatio 必须大于0且不超过1`);
  }
  if (decoration.opacity < 0 || decoration.opacity > 1) {
    throw new Error(`${decoration.id}: opacity 必须在0到1之间`);
  }
  if (decoration.marginRatio < 0 || decoration.marginRatio >= 0.5) {
    throw new Error(`${decoration.id}: marginRatio 必须大于等于0且小于0.5`);
  }
}

function coordinatesFor(
  anchor: Anchor,
  canvasWidth: number,
  canvasHeight: number,
  decorationWidth: number,
  decorationHeight: number,
  margin: number,
) {
  const isRight = anchor.endsWith("right");
  const isBottom = anchor.startsWith("bottom");

  return {
    left: isRight
      ? canvasWidth - decorationWidth - margin
      : margin,
    top: isBottom
      ? canvasHeight - decorationHeight - margin
      : margin,
  };
}

function collisionPixels(
  canvas: Buffer,
  canvasWidth: number,
  decoration: Buffer,
  decorationWidth: number,
  decorationHeight: number,
  left: number,
  top: number,
) {
  let collisions = 0;

  for (let y = 0; y < decorationHeight; y += 1) {
    for (let x = 0; x < decorationWidth; x += 1) {
      const decorationAlpha = decoration[
        ((y * decorationWidth + x) * 4) + 3
      ];
      if (decorationAlpha === 0) {
        continue;
      }

      const canvasIndex = (((top + y) * canvasWidth + left + x) * 4) + 3;
      if (canvas[canvasIndex] > 0) {
        collisions += 1;
      }
    }
  }

  return collisions;
}

function choosePlacement(
  pixels: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  decoration: DecorationSpec,
  decorationPixels: Buffer,
  width: number,
  height: number,
  margin: number,
): DecorationPlacement | undefined {
  const preferred = decoration.preferredAnchors ?? [];
  const anchors = [...new Set([...preferred, ...DEFAULT_ANCHORS])];

  const candidates = anchors.map((anchor, priority) => {
    const coordinates = coordinatesFor(
      anchor,
      canvasWidth,
      canvasHeight,
      width,
      height,
      margin,
    );

    return {
      anchor,
      priority,
      ...coordinates,
      collisions: collisionPixels(
        pixels,
        canvasWidth,
        decorationPixels,
        width,
        height,
        coordinates.left,
        coordinates.top,
      ),
    };
  });

  candidates.sort(
    (left, right) =>
      left.collisions - right.collisions || left.priority - right.priority,
  );

  const best = candidates[0];
  if (best.collisions > 0) {
    return undefined;
  }

  return {
    id: decoration.id,
    anchor: best.anchor,
    left: best.left,
    top: best.top,
    width,
    height,
  };
}

function paintDecoration(
  canvas: Buffer,
  canvasWidth: number,
  decoration: Buffer,
  decorationWidth: number,
  decorationHeight: number,
  placement: DecorationPlacement,
  opacity: number,
) {
  for (let y = 0; y < decorationHeight; y += 1) {
    for (let x = 0; x < decorationWidth; x += 1) {
      const sourceIndex = (y * decorationWidth + x) * 4;
      const sourceAlpha = decoration[sourceIndex + 3];
      if (sourceAlpha === 0) {
        continue;
      }

      const canvasX = placement.left + x;
      const canvasY = placement.top + y;
      const targetIndex = (canvasY * canvasWidth + canvasX) * 4;

      // Only paint transparent space. Existing subject pixels remain byte-for-byte unchanged.
      if (canvas[targetIndex + 3] > 0) {
        continue;
      }

      canvas[targetIndex] = decoration[sourceIndex];
      canvas[targetIndex + 1] = decoration[sourceIndex + 1];
      canvas[targetIndex + 2] = decoration[sourceIndex + 2];
      canvas[targetIndex + 3] = Math.round(sourceAlpha * opacity);
    }
  }
}

export async function composeDecorations(
  options: ComposeDecorationsOptions,
): Promise<ComposeDecorationsResult> {
  const input = await sharp(options.inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = input.info;
  if (channels !== 4) {
    throw new Error("输入图片必须能转换为RGBA格式");
  }

  const canvas = Buffer.from(input.data);
  const placements: DecorationPlacement[] = [];
  const skipped: ComposeDecorationsResult["skipped"] = [];

  let transparentPixels = 0;
  for (let index = 3; index < canvas.length; index += 4) {
    if (canvas[index] === 0) {
      transparentPixels += 1;
    }
  }
  if (transparentPixels === 0) {
    throw new Error("输入图片没有透明区域，无法放置装饰");
  }

  for (const decoration of options.decorations) {
    validateDecoration(decoration);

    const margin = Math.round(
      Math.min(width, height) * decoration.marginRatio,
    );
    const availableWidth = Math.max(1, width - margin * 2);
    const availableHeight = Math.max(1, height - margin * 2);
    const requestedWidth = Math.max(
      1,
      Math.min(availableWidth, Math.round(width * decoration.widthRatio)),
    );

    const resized = await sharp(decoration.path)
      .ensureAlpha()
      .resize({
        width: requestedWidth,
        height: availableHeight,
        fit: "inside",
        withoutEnlargement: false,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const placement = choosePlacement(
      canvas,
      width,
      height,
      decoration,
      resized.data,
      resized.info.width,
      resized.info.height,
      margin,
    );

    if (!placement) {
      skipped.push({
        id: decoration.id,
        reason: "没有可完整容纳装饰的空白角落",
      });
      continue;
    }

    paintDecoration(
      canvas,
      width,
      resized.data,
      resized.info.width,
      resized.info.height,
      placement,
      decoration.opacity,
    );
    placements.push(placement);
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  await sharp(canvas, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toFile(options.outputPath);

  return { width, height, placements, skipped };
}
