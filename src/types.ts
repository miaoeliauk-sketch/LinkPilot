export const ANCHORS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

export type Anchor = (typeof ANCHORS)[number];

export interface DecorationSpec {
  id: string;
  path: string;
  widthRatio: number;
  opacity: number;
  marginRatio: number;
  preferredAnchors?: Anchor[];
}

export interface ComposeDecorationsOptions {
  inputPath: string;
  outputPath: string;
  decorations: DecorationSpec[];
}

export interface DecorationPlacement {
  id: string;
  anchor: Anchor;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ComposeDecorationsResult {
  width: number;
  height: number;
  placements: DecorationPlacement[];
  skipped: Array<{
    id: string;
    reason: string;
  }>;
}
