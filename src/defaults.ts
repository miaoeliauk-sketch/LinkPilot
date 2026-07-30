import { fileURLToPath } from "node:url";
import type { DecorationSpec } from "./types.js";

export function defaultDecorations(): DecorationSpec[] {
  const asset = (name: string) =>
    fileURLToPath(new URL(`../assets/decorations/${name}`, import.meta.url));

  return [
    {
      id: "seal",
      path: asset("seal.png"),
      widthRatio: 0.14,
      opacity: 0.9,
      marginRatio: 0.04,
      preferredAnchors: ["bottom-right", "bottom-left"],
    },
    {
      id: "cloud",
      path: asset("cloud.png"),
      widthRatio: 0.24,
      opacity: 0.72,
      marginRatio: 0.04,
      preferredAnchors: ["top-right", "top-left"],
    },
    {
      id: "tape",
      path: asset("tape.png"),
      widthRatio: 0.22,
      opacity: 0.78,
      marginRatio: 0.04,
      preferredAnchors: ["top-left", "bottom-left"],
    },
  ];
}
