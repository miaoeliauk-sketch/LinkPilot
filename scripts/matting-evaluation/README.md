# scripts/matting-evaluation

独立于正式 pipeline 的智能抠图评价工具骨架。对应《V0.2-智能抠图评价工具方案.md》。

**边界（必须遵守）**：

- 只读取已有的抠图结果图和已有的参考蒙版，做量化比对。
- 不生成新图片，不调用 Codex/gpt-image-2。
- 不 import、不修改 `src/composite.ts`、`src/background.ts`、`src/intensity.ts`、`src/metadata.ts` 或其他正式 pipeline 文件。
- 产出的数字仍需人工填入《V0.2-智能抠图测试设计表.md》，本工具不自动下"转正/保留/排除"结论。

**当前状态：I/O 部分已完成最小样例验证（合成夹具，非真实素材）。**

- 验证方式：在装有项目依赖（`sharp`/`vitest`/`tsx`，与远程仓库`6d13103`版本一致）的隔离环境中，用程序合成的最小PNG（4×4、8×8像素，纯色/棋盘格图案，不含任何真人或真实项目素材）实际跑通了"读取抠图结果图 + 读取核心/细节蒙版 → 计算 → 输出JSON/Markdown"全流程，含CLI子进程真实退出码检查。测试文件：`matting-evaluation.test.ts`，23个测试用例全部通过（过程中发现并修复了1个真实bug：`mask-io.ts`的`readMaskPixels`此前是未实现的占位）。
- **仍未验证的部分**：真实标注工具导出的蒙版格式是否与`greyscale()`的假设一致（例如标注工具是否会导出非纯黑白的抗锯齿边缘，即使声称是"二值"）；1024×1024量级真实素材上的实际运行耗时（`metrics.ts`的`dilateMask`是简单的O(width×height×radius²)实现，代码注释已标注为已知优化空间，未在大尺寸图上测过实际耗时）；真实智能抠图工具的输出格式是否符合本工具假设的RGBA约定。这些需要在拿到真实素材后，作为任务卡3执行时的首批样例来验证，不能靠合成夹具替代。
- 测试运行方式（`vitest.config.ts`默认只扫描`tests/**/*.test.ts`，未包含本目录，需要显式指定）：
  ```bash
  npx vitest run scripts/matting-evaluation/matting-evaluation.test.ts --config <临时或扩展后的vitest配置>
  ```
  是否要把`vitest.config.ts`的`include`范围扩展到本目录、从而让本目录测试自动纳入`pnpm test`，是一个待决定事项，本次未修改根配置文件（保持改动范围仅限`scripts/matting-evaluation/`）。

## 目录

```
types.ts            类型定义
alpha-classify.ts    alpha三档判定
metrics.ts            核心/细节保留率、半透明占比、丢失率、误抠面积计算
mask-io.ts             参考蒙版读取、版本号解析（骨架）
env-snapshot.ts        运行环境信息采集（骨架）
report.ts               输出JSON + Markdown摘要（骨架）
cli.ts                   命令行入口（骨架）
```

## 使用方式（设计意图，尚未验证）

```bash
tsx scripts/matting-evaluation/cli.ts \
  --output <抠图结果PNG路径> \
  --core-mask <核心区域蒙版PNG路径> \
  --detail-mask <细节区域蒙版PNG路径> \
  --material-id HAIR-01 \
  --route ai-matting
```

## 明确不做的事

见《V0.2-智能抠图评价工具方案.md》第十三节：不实现抠图本身、不自动评边缘污染等级、不自动算重复运行标准差、不写入 `GenerationRecord`。
