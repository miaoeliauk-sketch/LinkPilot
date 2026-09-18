# VoicePilot · 口播体检

AI 口播文案检测与改写工具。和同仓库的 InkPilot（国风手账素材工具）没有任何关系，代码零耦合，只是共用一个仓库。

完整范围和验收标准见 `AI口播文案检测与改写工具_V0.1开发任务书.md`。

## 这个工具做什么，不做什么

做的是**「听起来像不像人说话」的风格诊断**，然后针对被标记的句子给改写建议。

**不做**「这段是不是某个模型生成的」的判定。人写的公文腔稿子会被判高分，AI 写完被人精修过的会被判低分——这都是对的。不要拿它当 AI 生成检测工具用。

## 当前进度

Day 1 完成：切句 + L1 规则层前三项（指纹词、三连排比、句长）+ 桌面应用外壳。

L2 模型判断层和定向改写还没做。三档标注（AI味／存疑／通过）要等两层合并策略，所以现在界面上只给指标和命中，不给结论。

## 桌面应用

```bash
pnpm install
pnpm app          # 直接运行
pnpm app:dist     # 打包成 macOS 安装包，产物在 release/
```

`pnpm app:dist` 要在 macOS 上执行，产出 arm64 和 x64 两个 dmg。

**词表放在用户数据目录**，不在应用包里：`~/Library/Application Support/Electron/config/`（打包后是应用自己的名字）。首次启动会从应用包里复制一份默认配置过去。点界面右上角「词表文件夹」直接在访达里打开，改完存盘，再点一次体检就生效，不用重启应用、不用改代码。

### 快捷键

| 键 | 作用 |
| --- | --- |
| `⌘` `↩` | 体检 |
| `Esc` | 回到编辑 |

## 命令行

界面和命令行共用同一个引擎，结果逐字一致。

```bash
pnpm diagnose -- --input 口播稿.txt
cat 口播稿.txt | pnpm diagnose
```

可选参数：`--json <报告输出路径>`、`--phrases <词表JSON>`、`--thresholds <阈值JSON>`。

命令行读的是 `src/voice/config/` 下的默认配置，桌面应用读的是用户数据目录里那份——两边可以不一样，报告里的版本号能看出用的是哪份。

## 阈值还没校准

`src/voice/config/thresholds.json` 里的版本号就叫 `thresholds-v0-uncalibrated`，全部是拍脑袋的初始值。

要校准需要 40 篇语料：20 篇真人口播逐字稿（从真实视频扒的口语原文，不能拿公众号文章顶替）+ 20 篇 AI 生成稿，放进 `corpus/human/` 和 `corpus/ai/`。误报率（人稿被误判）是这个工具的生死线，验收要求 ≤ 10%。

## 测试

```bash
pnpm test        # 引擎单元测试，快，不需要显示器
pnpm app:smoke   # 桌面应用冒烟测试：真起窗口、真走 IPC、截图存 tmp/smoke/
```

Linux 上没有显示器时冒烟测试要包一层：

```bash
xvfb-run -a node_modules/.bin/electron --no-sandbox --disable-gpu scripts/app-smoke.mjs
```
