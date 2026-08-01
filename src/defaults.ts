import { fileURLToPath } from "node:url";
import type { DecorationAssetId, DecorationSpec } from "./types.js";

const DECORATION_FILES: Record<DecorationAssetId, string> = {
  seal: "seal.png",
  cloud: "cloud.png",
  tape: "tape.png",
};

export function decorationPathForAsset(assetId: DecorationAssetId): string {
  return fileURLToPath(
    new URL(
      `../assets/decorations/${DECORATION_FILES[assetId]}`,
      import.meta.url,
    ),
  );
}

export function defaultDecorations(): DecorationSpec[] {
  return [
    {
      id: "seal",
      path: decorationPathForAsset("seal"),
      widthRatio: 0.14,
      opacity: 0.9,
      marginRatio: 0.04,
      preferredAnchors: ["bottom-right", "bottom-left"],
    },
    {
      id: "cloud",
      path: decorationPathForAsset("cloud"),
      widthRatio: 0.24,
      opacity: 0.72,
      marginRatio: 0.04,
      preferredAnchors: ["top-right", "top-left"],
    },
    {
      id: "tape",
      path: decorationPathForAsset("tape"),
      widthRatio: 0.22,
      opacity: 0.78,
      marginRatio: 0.04,
      preferredAnchors: ["top-left", "bottom-left"],
    },
  ];
}
