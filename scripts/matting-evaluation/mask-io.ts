import type { MaskVersion } from "./types.js";

/**
 * 骨架，未在本环境实际运行验证（本环境未安装 sharp 等项目依赖）。
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
 * TODO（骨架，未实现/未验证）：用 sharp 读取PNG为单通道灰度Uint8Array。
 * 读取后需要校验：
 *   1. 通道数可归约为单通道（灰度或RGBA的alpha/亮度一致）；
 *   2. 每个像素值只能是0或255（否则 metrics.ts 的 assertBinaryMask 会抛错，这里可以提前校验给出更早的错误定位）；
 *   3. 尺寸与被测抠图结果图一致。
 * 建议实现：
 *   const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
 *   // 蒙版通常是单通道灰度导出，若sharp读到的是RGBA，取R通道或alpha通道，具体取哪个通道
 *   // 取决于标注工具实际导出格式，需要在真实素材到手后确认，此处不预先假设。
 */
export async function readMaskPixels(_path: string): Promise<{
  data: Uint8Array;
  width: number;
  height: number;
}> {
  throw new Error(
    "readMaskPixels 尚未实现：需要在装有sharp依赖的实际开发环境中，根据标注工具实际导出的蒙版通道格式补全，本次未验证具体导出格式。",
  );
}
