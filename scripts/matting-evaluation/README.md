# scripts/matting-evaluation

独立于正式 pipeline 的智能抠图评价工具骨架。对应《V0.2-智能抠图评价工具方案.md》。

**边界（必须遵守）**：

- 只读取已有的抠图结果图和已有的参考蒙版，做量化比对。
- 不生成新图片，不调用 Codex/gpt-image-2。
- 不 import、不修改 `src/composite.ts`、`src/background.ts`、`src/intensity.ts`、`src/metadata.ts` 或其他正式 pipeline 文件。
- 产出的数字仍需人工填入《V0.2-智能抠图测试设计表.md》，本工具不自动下"转正/保留/排除"结论。

**当前状态：骨架代码，尚未在真实素材上运行验证。**

- `types.ts`、`alpha-classify.ts`、`metrics.ts`：纯函数，不依赖文件系统或图像库，理论上可独立单元测试（尚未编写测试，尚未实际运行）。
- `mask-io.ts`、`env-snapshot.ts`、`report.ts`、`cli.ts`：涉及文件读写和 `sharp` 图像解码的骨架，接口已定义，具体实现标注了 `TODO`，需要在装有 `sharp` 依赖的实际开发环境中补全并验证，本次未在此环境中运行测试（本环境未安装项目依赖）。

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
