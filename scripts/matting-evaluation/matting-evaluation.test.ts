import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { classifyAlpha, DEFAULT_ALPHA_THRESHOLDS } from "./alpha-classify.js";
import {
  assertRatiosSumTo100,
  coreRetentionRate,
  countRegionBands,
  detailFalsePositiveArea,
  detailOpaqueRetentionRate,
  detailSemiTransparentRatio,
  detailTransparentLossRate,
  obviousFalsePositiveArea,
} from "./metrics.js";
import { parseMaskFilename, readMaskPixels, toMaskVersion } from "./mask-io.js";
import { toJson, toMarkdownSummary } from "./report.js";
import { captureEnvSnapshot, SCRIPT_VERSION } from "./env-snapshot.js";
import type { EvaluationResult } from "./types.js";

/**
 * 本测试套件只使用程序合成生成的最小测试图像（4×4、8×8像素的纯色/棋盘格图案），
 * 不含任何真人、真实项目图片或外部素材。所有夹具在临时目录中生成，测试结束后清理，
 * 不提交进仓库。测试结果不得用于填写V0.2真实实验结论或V0.2-智能抠图测试设计表。
 */

let fixturesDir: string;
const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));

async function writeRgbaPng(
  path: string,
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => [number, number, number, number],
): Promise<void> {
  const buffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelFn(x, y);
      const idx = (y * width + x) * 4;
      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }
  await sharp(buffer, { raw: { width, height, channels: 4 } }).png().toFile(path);
}

async function writeGreyMaskPng(
  path: string,
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => number,
): Promise<void> {
  const buffer = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      buffer[y * width + x] = pixelFn(x, y);
    }
  }
  await sharp(buffer, { raw: { width, height, channels: 1 } }).png().toFile(path);
}

beforeAll(async () => {
  fixturesDir = await mkdtemp(join(tmpdir(), "matting-eval-fixtures-"));

  // 4x4 输出图：左半边(x<2) alpha=255完全不透明，右半边alpha=0完全透明
  await writeRgbaPng(join(fixturesDir, "output-4x4.png"), 4, 4, (x) => {
    const a = x < 2 ? 255 : 0;
    return [200, 100, 50, a];
  });

  // 4x4 核心蒙版：全部255（整张图都算"核心区域"）
  await writeGreyMaskPng(join(fixturesDir, "core-4x4.png"), 4, 4, () => 255);

  // 4x4 细节蒙版：只有左半边(x<2)是255，右半边是0——与输出图的透明/不透明分界重合
  await writeGreyMaskPng(join(fixturesDir, "detail-4x4.png"), 4, 4, (x) => (x < 2 ? 255 : 0));

  // 8x8 输出图，用于半透明/丢失/误抠的更细致组合测试
  // 细节区域(x<4, y<4)：x=0 alpha=255(不透明) / x=1 alpha=128(半透明) / x=2 alpha=3(透明) / x=3 alpha=255
  await writeRgbaPng(join(fixturesDir, "output-8x8.png"), 8, 8, (x, y) => {
    if (y >= 4) return [0, 0, 0, 0]; // 图像下半部分整体透明背景
    let a: number;
    if (x === 0) a = 255;
    else if (x === 1) a = 128;
    else if (x === 2) a = 3;
    else if (x === 3) a = 255;
    else a = 255; // x>=4 核心区域，完全不透明
    return [10, 20, 30, a];
  });

  await writeGreyMaskPng(join(fixturesDir, "core-8x8.png"), 8, 8, (x, y) => (x >= 4 && y < 4 ? 255 : 0));
  await writeGreyMaskPng(join(fixturesDir, "detail-8x8.png"), 8, 8, (x, y) => (x < 4 && y < 4 ? 255 : 0));

  // 非二值蒙版（含灰阶像素）
  await writeGreyMaskPng(join(fixturesDir, "nonbinary-mask.png"), 4, 4, (x) => (x === 0 ? 128 : 255));

  // 尺寸不一致的蒙版（2x2，小于4x4输出图）
  await writeGreyMaskPng(join(fixturesDir, "wrong-size-mask.png"), 2, 2, () => 255);

  // 损坏文件（写入非PNG字节内容，扩展名是.png）
  await writeFile(join(fixturesDir, "corrupted.png"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
});

afterAll(async () => {
  await rm(fixturesDir, { recursive: true, force: true });
});

describe("alpha三档判定", () => {
  it("边界值：>=250不透明，<=5透明，中间半透明", () => {
    expect(classifyAlpha(255)).toBe("opaque");
    expect(classifyAlpha(250)).toBe("opaque");
    expect(classifyAlpha(249)).toBe("semi");
    expect(classifyAlpha(128)).toBe("semi");
    expect(classifyAlpha(6)).toBe("semi");
    expect(classifyAlpha(5)).toBe("transparent");
    expect(classifyAlpha(0)).toBe("transparent");
  });

  it("非法alpha值（超出0-255）应报错", () => {
    expect(() => classifyAlpha(256)).toThrow(/0-255/);
    expect(() => classifyAlpha(-1)).toThrow(/0-255/);
  });

  it("默认阈值常量与文档一致", () => {
    expect(DEFAULT_ALPHA_THRESHOLDS).toEqual({ opaqueMin: 250, transparentMax: 5 });
  });
});

describe("蒙版文件名版本号解析", () => {
  it("合法文件名正确解析", () => {
    expect(parseMaskFilename("/some/dir/HAIR-01-core-v1.png")).toEqual({
      materialId: "HAIR-01",
      regionType: "core",
      version: "v1",
    });
    expect(toMaskVersion("/some/dir/HAIR-01-detail-v2.png")).toEqual({
      regionType: "detail",
      version: "v2",
      filePath: "/some/dir/HAIR-01-detail-v2.png",
    });
  });

  it("不合法文件名（缺版本号）应报错，不猜测版本", () => {
    expect(() => parseMaskFilename("HAIR-01-core.png")).toThrow(/命名规则/);
  });
});

describe("readMaskPixels（真实文件I/O）", () => {
  it("合法单通道二值蒙版可以正确读取", async () => {
    const result = await readMaskPixels(join(fixturesDir, "core-4x4.png"));
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.data.length).toBe(16);
    expect([...result.data]).toEqual(new Array(16).fill(255));
  });

  it("蒙版内容与写入时的图案一致（左半255右半0）", async () => {
    const result = await readMaskPixels(join(fixturesDir, "detail-4x4.png"));
    // row0: [255,255,0,0]
    expect([...result.data.slice(0, 4)]).toEqual([255, 255, 0, 0]);
  });

  it("文件不存在应明确报错", async () => {
    await expect(readMaskPixels(join(fixturesDir, "does-not-exist.png"))).rejects.toThrow(/不存在/);
  });

  it("损坏文件应明确报错（非零退出，非静默通过）", async () => {
    await expect(readMaskPixels(join(fixturesDir, "corrupted.png"))).rejects.toThrow(/无法解码/);
  });
});

describe("countRegionBands + assertBinaryMask（非二值蒙版必须报错）", () => {
  it("非二值蒙版必须报错，不静默容忍灰阶像素", async () => {
    const mask = await readMaskPixels(join(fixturesDir, "nonbinary-mask.png"));
    const alpha = new Uint8Array(16).fill(255);
    expect(() => countRegionBands(mask.data, alpha, DEFAULT_ALPHA_THRESHOLDS, "测试蒙版")).toThrow(
      /非二值像素/,
    );
  });

  it("蒙版与alpha通道长度不一致必须报错", () => {
    const mask = new Uint8Array(16).fill(255);
    const alpha = new Uint8Array(9).fill(255); // 长度不同
    expect(() => countRegionBands(mask, alpha, DEFAULT_ALPHA_THRESHOLDS, "测试蒙版")).toThrow(
      /长度不一致/,
    );
  });
});

describe("核心/细节保留率计算（用已知8x8构造验证精确数值）", () => {
  it("核心保留率、细节完全不透明保留率、细节半透明占比、细节完全透明丢失率计算正确", async () => {
    const output = await sharp(join(fixturesDir, "output-8x8.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = new Uint8Array(output.info.width * output.info.height);
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = output.data[i * 4 + 3];

    const coreMask = await readMaskPixels(join(fixturesDir, "core-8x8.png"));
    const detailMask = await readMaskPixels(join(fixturesDir, "detail-8x8.png"));

    const coreCounts = countRegionBands(coreMask.data, alpha, DEFAULT_ALPHA_THRESHOLDS, "核心");
    const detailCounts = countRegionBands(detailMask.data, alpha, DEFAULT_ALPHA_THRESHOLDS, "细节");

    // 核心区域：x>=4,y<4，共16像素，全部alpha=255（完全不透明）→ 100%
    expect(coreCounts.total).toBe(16);
    expect(coreRetentionRate(coreCounts)).toBeCloseTo(100, 6);

    // 细节区域：x<4,y<4，共16像素（4行，每行4个像素：x=0..3）
    // 每行 x=0(255不透明) x=1(128半透明) x=2(3透明) x=3(255不透明)
    // 4行共16像素：不透明8个(x=0,3各4行) 半透明4个(x=1) 透明4个(x=2)
    expect(detailCounts.total).toBe(16);
    expect(detailCounts.opaque).toBe(8);
    expect(detailCounts.semi).toBe(4);
    expect(detailCounts.transparent).toBe(4);

    const retention = detailOpaqueRetentionRate(detailCounts);
    const semiRatio = detailSemiTransparentRatio(detailCounts);
    const lossRate = detailTransparentLossRate(detailCounts);

    expect(retention).toBeCloseTo(50, 6); // 8/16
    expect(semiRatio).toBeCloseTo(25, 6); // 4/16
    expect(lossRate).toBeCloseTo(25, 6); // 4/16

    // 三项之和必须为100%，且不抛错
    expect(() => assertRatiosSumTo100(retention, semiRatio, lossRate)).not.toThrow();
    expect(retention + semiRatio + lossRate).toBeCloseTo(100, 6);
  });

  it("明显误抠面积与细节误抠面积可以计算（不抛错，数值非负）", async () => {
    const output = await sharp(join(fixturesDir, "output-8x8.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = new Uint8Array(output.info.width * output.info.height);
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = output.data[i * 4 + 3];

    const coreMask = await readMaskPixels(join(fixturesDir, "core-8x8.png"));
    const detailMask = await readMaskPixels(join(fixturesDir, "detail-8x8.png"));

    const obvious = obviousFalsePositiveArea(
      coreMask.data,
      detailMask.data,
      alpha,
      { width: 8, height: 8 },
      DEFAULT_ALPHA_THRESHOLDS,
    );
    expect(obvious.pixelCount).toBeGreaterThanOrEqual(0);
    expect(obvious.ratio).toBeGreaterThanOrEqual(0);

    const detailFP = detailFalsePositiveArea(
      detailMask.data,
      alpha,
      { width: 8, height: 8 },
      2,
      DEFAULT_ALPHA_THRESHOLDS,
    );
    expect(detailFP.pixelCount).toBeGreaterThanOrEqual(0);
    expect(detailFP.bufferRadiusPixels).toBe(2);
  });
});

describe("report.ts：JSON与Markdown输出", () => {
  const sampleResult: EvaluationResult = {
    materialId: "TEST-01",
    route: "ai-matting",
    runIndex: "1",
    coreRetentionRate: 100,
    detailOpaqueRetentionRate: 50,
    detailSemiTransparentRatio: 25,
    detailTransparentLossRate: 25,
    obviousFalsePositiveArea: { pixelCount: 0, ratio: 0 },
    detailFalsePositiveArea: { pixelCount: 1, ratio: 6.25, bufferRadiusPixels: 5 },
    maskVersions: {
      core: { regionType: "core", version: "v1", filePath: "core-v1.png" },
      detail: { regionType: "detail", version: "v2", filePath: "detail-v2.png" },
    },
    params: {
      alphaThresholds: { opaqueMin: 250, transparentMax: 5 },
      detailBufferRadiusPixels: 5,
    },
    scriptVersion: SCRIPT_VERSION,
    computedAt: "2026-08-04T00:00:00.000Z",
    inputFiles: { outputImage: "out.png", coreMask: "core-v1.png", detailMask: "detail-v2.png" },
  };

  it("toJson 产出可解析的JSON，字段完整", () => {
    const json = toJson(sampleResult);
    const parsed = JSON.parse(json);
    expect(parsed.materialId).toBe("TEST-01");
    expect(parsed.detailOpaqueRetentionRate).toBe(50);
    expect(parsed.maskVersions.core.version).toBe("v1");
    expect(parsed.params.alphaThresholds.opaqueMin).toBe(250);
    expect(parsed.params.detailBufferRadiusPixels).toBe(5);
    expect(parsed.scriptVersion).toBe(SCRIPT_VERSION);
  });

  it("toMarkdownSummary 包含实际使用的阈值、缓冲带宽度、蒙版版本、脚本版本", () => {
    const md = toMarkdownSummary(sampleResult);
    expect(md).toContain("TEST-01");
    expect(md).toContain("v1"); // 核心蒙版版本
    expect(md).toContain("v2"); // 细节蒙版版本
    expect(md).toContain("250"); // alpha不透明阈值
    expect(md).toContain("5"); // 透明阈值/缓冲带宽度
    expect(md).toContain(SCRIPT_VERSION);
    expect(md).toContain("人工"); // 提醒未产出字段需人工评级
  });
});

describe("env-snapshot：运行环境采集", () => {
  it("包含Node版本、脚本版本、时间戳，且列出需人工补充的字段", () => {
    const snapshot = captureEnvSnapshot();
    expect(snapshot.nodeVersion).toMatch(/^v\d+/);
    expect(snapshot.scriptVersion).toBe(SCRIPT_VERSION);
    expect(snapshot.timestamp).toBeTruthy();
    expect(snapshot.manualFieldsReminder).toContain("CPU型号");
    expect(snapshot.manualFieldsReminder).toContain("GPU型号（如有）");
  });
});

describe("cli.ts 端到端（真实子进程，检查退出码）", () => {
  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("npx", ["tsx", CLI_PATH, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const err = error as { status: number | null; stdout: Buffer; stderr: Buffer };
      return {
        status: err.status ?? 1,
        stdout: err.stdout?.toString() ?? "",
        stderr: err.stderr?.toString() ?? "",
      };
    }
  }

  it("合法输入：成功产出JSON+Markdown，退出码0", () => {
    const outPath = join(fixturesDir, "output-4x4.png");
    const corePath = join(fixturesDir, "TEST-01-core-v1.png");
    const detailPath = join(fixturesDir, "TEST-01-detail-v1.png");
    return Promise.all([
      writeGreyMaskPng(corePath, 4, 4, () => 255),
      writeGreyMaskPng(detailPath, 4, 4, (x) => (x < 2 ? 255 : 0)),
    ]).then(() => {
      const result = runCli([
        "--output",
        outPath,
        "--core-mask",
        corePath,
        "--detail-mask",
        detailPath,
        "--material-id",
        "TEST-01",
        "--route",
        "ai-matting",
        "--run-index",
        "1",
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"materialId": "TEST-01"');
      expect(result.stdout).toContain("### TEST-01");
    });
  }, 30000);

  it("缺失文件：非零退出码，报错信息指明文件路径", () => {
    const result = runCli([
      "--output",
      join(fixturesDir, "does-not-exist-output.png"),
      "--core-mask",
      join(fixturesDir, "core-4x4.png"),
      "--detail-mask",
      join(fixturesDir, "detail-4x4.png"),
      "--material-id",
      "TEST-01",
      "--route",
      "ai-matting",
      "--run-index",
      "1",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/不存在/);
  }, 30000);

  it("损坏文件：非零退出码", () => {
    const result = runCli([
      "--output",
      join(fixturesDir, "corrupted.png"),
      "--core-mask",
      join(fixturesDir, "core-4x4.png"),
      "--detail-mask",
      join(fixturesDir, "detail-4x4.png"),
      "--material-id",
      "TEST-01",
      "--route",
      "ai-matting",
      "--run-index",
      "1",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/无法解码/);
  }, 30000);

  it("尺寸不一致：非零退出码，不静默通过", () => {
    const result = runCli([
      "--output",
      join(fixturesDir, "output-4x4.png"),
      "--core-mask",
      join(fixturesDir, "wrong-size-mask.png"),
      "--detail-mask",
      join(fixturesDir, "detail-4x4.png"),
      "--material-id",
      "TEST-01",
      "--route",
      "ai-matting",
      "--run-index",
      "1",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/尺寸.*不一致/);
  }, 30000);

  it("非二值蒙版：非零退出码", () => {
    const result = runCli([
      "--output",
      join(fixturesDir, "output-4x4.png"),
      "--core-mask",
      join(fixturesDir, "nonbinary-mask.png"),
      "--detail-mask",
      join(fixturesDir, "detail-4x4.png"),
      "--material-id",
      "TEST-01",
      "--route",
      "ai-matting",
      "--run-index",
      "1",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/非二值像素/);
  }, 30000);

  it("参数缺失：非零退出码，输出用法说明", () => {
    const result = runCli(["--output", join(fixturesDir, "output-4x4.png")]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/用法/);
  }, 30000);
});

describe("不import正式src文件（自动化检查）", () => {
  it("scripts/matting-evaluation 下所有源文件都不引用 ../../src 或 ../src", async () => {
    const files = [
      "types.ts",
      "alpha-classify.ts",
      "metrics.ts",
      "mask-io.ts",
      "env-snapshot.ts",
      "report.ts",
      "cli.ts",
    ];
    for (const file of files) {
      const content = await readFile(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
      expect(content).not.toMatch(/from\s+["'].*\/src\//);
      expect(content).not.toMatch(/from\s+["']\.\.\/src/);
    }
  });
});
