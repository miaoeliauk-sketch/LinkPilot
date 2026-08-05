import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import {
  classifyImage,
  classifyByDistance,
  colorDistance,
  parseChromaKey,
  draftBinaryForegroundMask,
  erode,
  buildCoreAndDetailMasks,
  buildReviewOverlay,
  DEFAULT_THRESHOLDS,
  CHROMA_KEYS,
} from "./generate-reference-mask.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let fixturesDir: string;
const SCRIPT_PATH = fileURLToPath(new URL("./generate-reference-mask.ts", import.meta.url));

async function writeRgbPng(
  path: string,
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => [number, number, number],
): Promise<void> {
  const buffer = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelFn(x, y);
      const idx = (y * width + x) * 3;
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
    }
  }
  await sharp(buffer, { raw: { width, height, channels: 3 } }).png().toFile(path);
}

beforeAll(async () => {
  fixturesDir = await mkdtemp(join(tmpdir(), "mask-gen-fixtures-"));

  // 12x12 绿幕图：中间一个8x8的深蓝色实心方块主体（内部无孔），四周绿幕
  await writeRgbPng(join(fixturesDir, "solid-12x12.png"), 12, 12, (x, y) => {
    const inSubject = x >= 2 && x < 10 && y >= 2 && y < 10;
    return inSubject ? [46, 64, 87] : [0, 255, 0]; // 46,64,87 = #2E4057 黛蓝
  });

  // 12x12 绿幕图：8x8深蓝方块，中间挖一个2x2的"孔"（透出绿幕）——模拟LEAF-02式孔洞
  await writeRgbPng(join(fixturesDir, "with-hole-12x12.png"), 12, 12, (x, y) => {
    const inSubject = x >= 2 && x < 10 && y >= 2 && y < 10;
    const inHole = x >= 5 && x < 7 && y >= 5 && y < 7;
    if (inHole) return [0, 255, 0];
    return inSubject ? [46, 64, 87] : [0, 255, 0];
  });

  // 8x1 一行像素，从纯绿幕线性过渡到深蓝，用于验证三档分类边界
  await writeRgbPng(join(fixturesDir, "gradient-8x1.png"), 8, 1, (x) => {
    const t = x / 7;
    const r = Math.round(0 + t * 46);
    const g = Math.round(255 + t * (64 - 255));
    const b = Math.round(0 + t * 87);
    return [r, g, b];
  });
});

afterAll(async () => {
  await rm(fixturesDir, { recursive: true, force: true });
});

describe("色度距离与三档分类", () => {
  it("colorDistance 计算正确", () => {
    expect(colorDistance({ r: 0, g: 255, b: 0 }, { r: 0, g: 255, b: 0 })).toBe(0);
    expect(colorDistance({ r: 255, g: 255, b: 255 }, { r: 0, g: 255, b: 0 })).toBeCloseTo(
      Math.sqrt(255 * 255 + 0 + 255 * 255),
      6,
    );
  });

  it("三档边界：<=backgroundMax背景，>=foregroundMin前景，中间模糊", () => {
    const t = DEFAULT_THRESHOLDS;
    expect(classifyByDistance(0, t)).toBe("background");
    expect(classifyByDistance(t.backgroundMax, t)).toBe("background");
    expect(classifyByDistance(t.backgroundMax + 1, t)).toBe("ambiguous");
    expect(classifyByDistance(t.foregroundMin - 1, t)).toBe("ambiguous");
    expect(classifyByDistance(t.foregroundMin, t)).toBe("foreground");
    expect(classifyByDistance(999, t)).toBe("foreground");
  });

  it("阈值配置错误（下限>=上限）应报错", () => {
    expect(() => classifyByDistance(50, { backgroundMax: 100, foregroundMin: 50 })).toThrow(
      /阈值配置错误/,
    );
  });

  it("parseChromaKey 支持green/magenta/十六进制", () => {
    expect(parseChromaKey("green")).toEqual(CHROMA_KEYS.green);
    expect(parseChromaKey("magenta")).toEqual(CHROMA_KEYS.magenta);
    expect(parseChromaKey("#2E4057")).toEqual({ r: 46, g: 64, b: 87 });
    expect(() => parseChromaKey("not-a-color")).toThrow(/必须是/);
  });
});

describe("实心方块（无孔）分类与核心/细节拆分", () => {
  it("纯色块场景下，前景像素数量等于方块面积，背景像素数量等于四周绿幕面积", async () => {
    const { data, info } = await sharp(join(fixturesDir, "solid-12x12.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const classification = classifyImage(new Uint8Array(data), { width: info.width, height: info.height }, CHROMA_KEYS.green);

    expect(classification.foregroundCount).toBe(8 * 8); // 8x8方块
    expect(classification.backgroundCount).toBe(12 * 12 - 8 * 8);
    expect(classification.ambiguousCount).toBe(0); // 纯色块无渐变，不应有模糊像素
  });

  it("核心蒙版应严格小于等于细节所在的完整前景（腐蚀后变小）", async () => {
    const { data, info } = await sharp(join(fixturesDir, "solid-12x12.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const dims = { width: info.width, height: info.height };
    const classification = classifyImage(new Uint8Array(data), dims, CHROMA_KEYS.green);
    const { core, detail } = buildCoreAndDetailMasks(classification, 1);

    const coreCount = [...core].filter((v) => v === 255).length;
    const detailCount = [...detail].filter((v) => v === 255).length;
    const foregroundTotal = classification.foregroundCount;

    expect(coreCount).toBeLessThan(foregroundTotal); // 腐蚀后核心必然比完整前景小
    expect(coreCount + detailCount).toBe(foregroundTotal); // 核心+细节应精确覆盖全部前景，不重不漏
  });
});

describe("带内部孔洞的方块（模拟LEAF-02式镂空叶片）", () => {
  it("孔洞内部像素必须被判定为背景，不能被误判为前景", async () => {
    const { data, info } = await sharp(join(fixturesDir, "with-hole-12x12.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const dims = { width: info.width, height: info.height };
    const classification = classifyImage(new Uint8Array(data), dims, CHROMA_KEYS.green);

    // 孔洞是x:[5,7) y:[5,7)，共4个像素，颜色和背景一样，必须全部判定为background
    const holeIndices = [
      5 * dims.width + 5,
      5 * dims.width + 6,
      6 * dims.width + 5,
      6 * dims.width + 6,
    ];
    for (const idx of holeIndices) {
      expect(classification.bands[idx]).toBe("background");
    }

    // 前景总数应比无孔版本少4个（8x8整块=64，减去4个孔=60）
    expect(classification.foregroundCount).toBe(8 * 8 - 4);
  });

  it("孔洞不应出现在最终的core或detail蒙版里", async () => {
    const { data, info } = await sharp(join(fixturesDir, "with-hole-12x12.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const dims = { width: info.width, height: info.height };
    const classification = classifyImage(new Uint8Array(data), dims, CHROMA_KEYS.green);
    const { core, detail } = buildCoreAndDetailMasks(classification, 1);

    const holeIndices = [
      5 * dims.width + 5,
      5 * dims.width + 6,
      6 * dims.width + 5,
      6 * dims.width + 6,
    ];
    for (const idx of holeIndices) {
      expect(core[idx]).toBe(0);
      expect(detail[idx]).toBe(0);
    }
  });
});

describe("渐变过渡带：验证模糊区域确实被标记，而不是被强行二选一吞掉", () => {
  it("渐变行中应同时出现background/ambiguous/foreground三种判定，且ambiguous占比非零", async () => {
    const { data, info } = await sharp(join(fixturesDir, "gradient-8x1.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const classification = classifyImage(new Uint8Array(data), { width: info.width, height: info.height }, CHROMA_KEYS.green);

    const bandSet = new Set(classification.bands);
    expect(bandSet.has("background")).toBe(true);
    expect(bandSet.has("foreground")).toBe(true);
    // 8个像素的线性渐变，用默认阈值应至少落入一个模糊像素（不强制具体数量，只验证机制生效）
    expect(classification.ambiguousCount).toBeGreaterThan(0);
  });

  it("draftBinaryForegroundMask 对模糊像素默认判为背景（保守默认，不臆断为主体）", async () => {
    const { data, info } = await sharp(join(fixturesDir, "gradient-8x1.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const classification = classifyImage(new Uint8Array(data), { width: info.width, height: info.height }, CHROMA_KEYS.green);
    const draft = draftBinaryForegroundMask(classification);

    for (let i = 0; i < classification.bands.length; i += 1) {
      if (classification.bands[i] === "ambiguous") {
        expect(draft[i]).toBe(0); // 模糊像素默认不算前景，等待人工复核确认
      }
    }
  });

  it("buildReviewOverlay 把模糊像素标记为纯红色，其余像素明显调暗", async () => {
    const { data, info } = await sharp(join(fixturesDir, "gradient-8x1.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const dims = { width: info.width, height: info.height };
    const classification = classifyImage(new Uint8Array(data), dims, CHROMA_KEYS.green);
    const overlay = buildReviewOverlay(new Uint8Array(data), classification);

    for (let i = 0; i < classification.bands.length; i += 1) {
      const idx = i * 3;
      if (classification.bands[i] === "ambiguous") {
        expect([overlay[idx], overlay[idx + 1], overlay[idx + 2]]).toEqual([255, 0, 0]);
      } else {
        expect(overlay[idx]).toBeLessThanOrEqual(data[idx]);
      }
    }
  });
});

describe("erode 形态学腐蚀基本行为", () => {
  it("对全前景的实心方块，腐蚀半径1应该只剩内部一圈", () => {
    const dims = { width: 5, height: 5 };
    const mask = new Uint8Array(25).fill(255); // 5x5全部前景
    const result = erode(mask, dims, 1);
    // 只有中心(2,2)距离所有边界都>=1+1，边缘一圈会被腐蚀掉
    expect(result[2 * 5 + 2]).toBe(255); // 中心保留
    expect(result[0]).toBe(0); // 左上角必然被腐蚀
  });

  it("蒙版尺寸与声明不符应报错", () => {
    expect(() => erode(new Uint8Array(10), { width: 4, height: 4 }, 1)).toThrow(/不一致/);
  });
});

describe("generate-reference-mask.ts 端到端CLI", () => {
  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("npx", ["tsx", SCRIPT_PATH, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const err = error as { status: number | null; stdout: Buffer; stderr: Buffer };
      return { status: err.status ?? 1, stdout: err.stdout?.toString() ?? "", stderr: err.stderr?.toString() ?? "" };
    }
  }

  it("对孔洞图跑通全流程，产出草稿蒙版+复核图+报告，退出码0", async () => {
    const outDir = join(fixturesDir, "cli-out");
    const result = runCli([
      "--source",
      join(fixturesDir, "with-hole-12x12.png"),
      "--chroma",
      "green",
      "--material-id",
      "TEST-HOLE",
      "--out-dir",
      outDir,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("core-draft.png");

    const report = JSON.parse(
      await readFile(join(outDir, "TEST-HOLE-mask-generation-report.json"), "utf8"),
    );
    expect(report.foregroundPixels).toBe(8 * 8 - 4);
    expect(report.materialId).toBe("TEST-HOLE");

    // 确认孔洞在实际写出的core-draft.png里也确实是0（不是只在内存对象里对，文件本身也要对）
    const coreDraft = await sharp(join(outDir, "TEST-HOLE-core-draft.png"))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const holeIdx = 5 * 12 + 5;
    expect(coreDraft.data[holeIdx]).toBe(0);
  }, 30000);

  it("参数缺失应非零退出并提示用法", () => {
    const result = runCli(["--source", join(fixturesDir, "solid-12x12.png")]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/用法/);
  }, 30000);

  it("不存在的源文件应非零退出", () => {
    const result = runCli([
      "--source",
      join(fixturesDir, "does-not-exist.png"),
      "--chroma",
      "green",
      "--material-id",
      "X",
      "--out-dir",
      join(fixturesDir, "cli-out2"),
    ]);
    expect(result.status).not.toBe(0);
  }, 30000);
});
