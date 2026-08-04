/**
 * 骨架，未在本环境实际运行验证。
 * 只采集Node.js可以跨平台可靠获取的部分；CPU型号/内存容量/GPU型号/显存容量
 * 不做跨平台猜测性采集（容易在不同操作系统上得到不可靠或不一致的结果），
 * 明确提示使用者去测试表"运行环境记录表"手动填写，避免自动化程度不足反而误导为"已记录"。
 */

export interface EnvSnapshot {
  nodeVersion: string;
  scriptVersion: string;
  timestamp: string;
  manualFieldsReminder: string[];
}

export const SCRIPT_VERSION = "0.1.0-draft";

export function captureEnvSnapshot(): EnvSnapshot {
  return {
    nodeVersion: typeof process !== "undefined" ? process.version : "未知（非Node环境运行）",
    scriptVersion: SCRIPT_VERSION,
    timestamp: new Date().toISOString(),
    manualFieldsReminder: [
      "测试设备型号",
      "操作系统及版本",
      "CPU型号",
      "内存容量",
      "GPU型号（如有）",
      "显存容量（如有）",
      "智能抠图所用模型/库名称及版本号",
    ],
  };
}
