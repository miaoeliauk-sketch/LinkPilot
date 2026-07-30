# InkPilot

国风手账素材工具 V0.1。当前已完成 Day 4 第一版：在透明 PNG 的最终分辨率上，自动叠加固定的印章、云纹和胶带素材。

## 当前范围

- 输入、输出均为带透明通道的 PNG
- 装饰只绘制在透明区域，不修改主体像素
- 根据透明通道判断占用情况，优先选择空白较多的角落
- 如果没有能完整容纳装饰的角落，会明确跳过该装饰，不会把图案切碎
- 如果输入图片没有透明区域，会直接报错，不会产生“看似成功但没有装饰”的结果
- 默认使用朱红印章、黛蓝云纹、月白/藤黄胶带
- 方格纸、宣纸纹理属于整张背景处理，不包含在 Day 4 第一版中

## 安装

```bash
pnpm install
```

## 使用默认装饰

```bash
pnpm compose -- \
  --input /绝对路径/主体透明图.png \
  --output /绝对路径/最终图片.png
```

## 使用自定义装饰配置

```bash
pnpm compose -- \
  --input /绝对路径/主体透明图.png \
  --output /绝对路径/最终图片.png \
  --manifest /绝对路径/decorations.json
```

配置示例：

```json
{
  "decorations": [
    {
      "id": "seal",
      "path": "./seal.png",
      "widthRatio": 0.14,
      "opacity": 0.9,
      "marginRatio": 0.04,
      "preferredAnchors": ["bottom-right", "bottom-left"]
    }
  ]
}
```

- `widthRatio`：装饰宽度占画布宽度的比例
- `opacity`：透明度，范围为0至1
- `marginRatio`：安全边距占画布短边的比例
- `preferredAnchors`：候选角落的优先顺序，可选

自定义素材路径如果使用相对路径，会以配置文件所在目录为基准。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm build
```

测试覆盖：画布尺寸不变、透明通道保留、主体像素不变、装饰不越界、透明区域出现装饰，以及默认3种素材可以共同合成。

真人肖像只用于本地验收，不上传公共仓库。
