import { stat } from "node:fs/promises";
import sharp from "sharp";
import type { MaskVersion } from "./types.js";

/**
 * 命名规则见《V0.2-素材蒙版与授权检查规范.md》，形如：HAIR-01-core-v1.png / HAIR-01-detail-v2.png
 */
const MASK_FILENAME_PATTERN = /^(?<materialId>[A-Z]+-\d+)-(?<regionType>core|detail)-v(?<version>\d+)\.png$/;

export function parseMaskFilename(filePath: string): {
  materialId: string;
  regionType: "core" | "detail";
  version: string;
} {
  const filename = filePath.split("/").pop() ?? filePath;
  const match = MASK_FILENAME_PATTERN.exec(filename);
  if (!match?.groups) {
    throw new Error(
      `蒙版文件名不符合命名规则（应为 素材编号-core|detail-v版本号.png）：${filename}。` +
        `不允许工具猜测版本号，请按《V0.2-素材蒙版与授权检查规范.md》重新命名后再运行。`,
    );
  }
  return {
    materialId: match.groups.materialId,
    regionType: match.groups.regionType as "core" | "detail",
    version: `v${match.groups.version}`,
  };
}

export function toMaskVersion(filePath: string): MaskVersion {
  const parsed = parseMaskFilename(filePath);
  return { regionType: parsed.regionType, version: parsed.version, filePath };
}

/**
 * 读取蒙版为单通道灰度像素数组。蒙版命名和二值合法性（是否只含0/255）由调用方
 * （metrics.ts 的 assertBinaryMask）校验，本函数只负责"能不能读到像素"这一层。
 * 用 sharp 的 greyscale() 统一处理蒙版可能被导出为RGB/RGBA/已是灰度这几种情况，
 * 而不是假设标注工具一定导出严格单通道文件。
 */
export async function readMaskPixels(path: string): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}> {
  try {
    await stat(path);
  } catch {
    throw new Error(`蒙版文件不存在：${path}`);
  }

  const { data, info } = await sharp(path)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`蒙版文件无法解码（可能已损坏或不是有效图片格式）：${path}（${message}）`);
    });

  if (info.channels !== 1) {
    throw new Error(`蒙版灰度化后通道数应为1，实际为${info.channels}：${path}`);
  }

  return { data: new Uint8Array(data), width: info.width, height: info.height };
}
