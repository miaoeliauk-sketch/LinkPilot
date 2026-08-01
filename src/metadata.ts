import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export const SOURCE_TYPE_OPTIONS = ["real", "ai"] as const;
export type SourceTypeOption = (typeof SOURCE_TYPE_OPTIONS)[number];
export type SourceType = "实拍" | "AI测试素材";
export type HumanReview = "通过" | "不通过" | "待定";

export interface GenerationRecord {
  input_image: string;
  source_type: SourceType;
  params: Record<string, unknown>;
  output_image: string;
  timestamp: string;
  human_review: HumanReview;
}

export interface WriteGenerationRecordInput {
  inputImage: string;
  sourceType: SourceType;
  params: Record<string, unknown>;
  outputImage: string;
  recordsDirectory?: string;
  humanReview?: HumanReview;
}

export function sourceTypeFromOption(option: SourceTypeOption): SourceType {
  return option === "real" ? "实拍" : "AI测试素材";
}

export function recordsDirectoryForOutput(
  outputImage: string,
  override?: string,
): string {
  return override ?? join(dirname(outputImage), "records");
}

export async function prepareRecordsDirectory(
  outputImage: string,
  override?: string,
): Promise<string> {
  const recordsDirectory = recordsDirectoryForOutput(outputImage, override);
  try {
    await mkdir(recordsDirectory, { recursive: true });
    await access(recordsDirectory, constants.W_OK);
  } catch {
    throw new Error(`记录目录不可用：${recordsDirectory}`);
  }
  return recordsDirectory;
}

export async function writeGenerationRecord(
  input: WriteGenerationRecordInput,
): Promise<string> {
  const timestamp = new Date().toISOString();
  const outputStem = basename(
    input.outputImage,
    extname(input.outputImage),
  );
  const safeTimestamp = timestamp.replaceAll(":", "-");
  const recordsDirectory = recordsDirectoryForOutput(
    input.outputImage,
    input.recordsDirectory,
  );
  const recordPath = join(
    recordsDirectory,
    `${outputStem}-${safeTimestamp}-${randomUUID().slice(0, 8)}.json`,
  );
  const record: GenerationRecord = {
    input_image: input.inputImage,
    source_type: input.sourceType,
    params: input.params,
    output_image: input.outputImage,
    timestamp,
    human_review: input.humanReview ?? "待定",
  };

  await mkdir(recordsDirectory, { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return recordPath;
}
