# 第0步：FramePilot 与 My-Motion 技术栈扫描结果

扫描日期：2026-07-29

扫描范围：

- FramePilot：`/Users/pengzhiliang/Documents/Codex/B-roll`
- My-Motion：`/Users/pengzhiliang/Desktop/my-motion`

本次只进行静态扫描，没有修改两个项目，也没有启动、渲染或覆盖任何已有视频。

## 一、FramePilot

> 文件夹名为 `B-roll`，但 `package.json` 中的正式项目名是 `framepilot`。

### 1. 主要语言和框架

- 主要语言：TypeScript、TSX、CSS、少量 Node.js JavaScript
- 前端：React 18
- 开发与构建：Vite 8、TypeScript 5.6
- 视频预览与渲染：Remotion 4.0.410
- 动画：GSAP 3.15
- 图标：Lucide React
- 包管理：npm（存在 `package-lock.json`）

### 2. 第三方库和外部 API

主要第三方库：

- `react`、`react-dom`
- `remotion`
- `@remotion/player`
- `@remotion/bundler`
- `@remotion/renderer`
- `gsap`
- `lucide-react`

没有发现正在调用的云端业务 API，也没有 OpenAI、Claude、数据库、对象存储或登录系统。当前脚本分析、参考视频分析、预览和导出都在本机完成。

### 3. 素材输入、保存和导出

图片输入：

- 页面中的“视觉素材池”支持 `image/*`，可一次上传多张。
- 图片会通过 `FileReader.readAsDataURL()`转成 Base64 Data URL。
- 数据保存在 React 内存状态中的 `VisualAsset`对象里，包括名称、类型、缩略图和用途。
- 图片类型包括普通图片、海报、人物、产品、截图、背景和纹理。

视频输入：

- 参考视频和镜头库支持 MP4、MOV、WebM。
- 通过浏览器本地对象地址读取，不上传云端。
- 本地读取视频时长、尺寸、关键帧、亮度、对比度等信息。

配置保存：

- 可下载 `framepilot-config.json`。
- JSON 中包含分析输入、B-roll 镜头列表和素材数组。
- 因为图片以 Data URL 存入 JSON，大图较多时文件会明显膨胀。

视频导出：

- 命令行脚本读取 JSON 请求文件，传给 Remotion。
- 输出 H.264 MP4，保存到项目的 `exports/`目录。
- 文件名形如 `broll_01_codewindow.mp4`。
- 当前默认命令可能覆盖同名旧文件；恢复测试命令使用单独文件名。

其他输出：

- 可复制剪辑时间轴文字。
- 可复制当前镜头 JSON。
- 可复制 AE 工程方案。

### 4. 对外接口

没有发现业务 HTTP API。

当前可调用方式有两种：

1. 浏览器页面内部调用 React 函数。
2. 命令行调用：

```bash
npm run render -- --payload=某个请求文件.json
```

请求 JSON 的核心结构为：

```json
{
  "stylePreset": "极简科技风",
  "items": [],
  "assets": []
}
```

因此 FramePilot 已具备“通过 JSON 接收素材和镜头参数”的基础，但还没有稳定的网络接口。

### 5. 启动和调试方式

安装依赖：

```bash
npm install
```

启动前端：

```bash
npm run dev
```

默认地址通常为`http://localhost:5173/`。

打开 Remotion Studio：

```bash
npm run remotion:studio
```

导出默认视频：

```bash
npm run render:current
```

使用请求文件导出：

```bash
npm run render -- --payload=exports/requests/restore-test-render-request.json
```

构建与已有测试：

```bash
npm run build
npm run test:v061
```

## 二、My-Motion

### 1. 主要语言和框架

- 主要语言：JavaScript、JSX、CSS、少量 JSON
- 前端：React 19
- 视频预览与渲染：Remotion 4.0.438
- 编辑器开发与构建：Vite 8
- 样式：Tailwind CSS 4，以及项目 CSS
- 参数校验：Zod 4
- 本地导出服务：Node.js 原生 HTTP Server
- 包管理：pnpm 10（存在 `pnpm-lock.yaml`）

项目约束：

- Remotion 会并行、乱序渲染帧，每一帧必须独立计算，不能依赖上一帧状态。
- 视觉效果非必要不跑自动化验证，以人工目测为主。

### 2. 第三方库和外部 API

主要第三方库：

- `react`、`react-dom`
- `remotion`
- `@remotion/cli`
- `@remotion/player`
- `@remotion/studio`
- `@remotion/media-utils`
- `@remotion/zod-types`
- `tailwindcss`
- `zod`

没有发现云端业务 API、数据库、账号系统或 AI 接口。编辑、预览、导出全部在本机完成。

### 3. 素材输入、保存和导出

日常编辑器输入：

- 当前主要输入是模板参数 JSON，包括文字、数字、颜色、位置、透明背景等。
- 当前有三个模板：关键词强调、数字递增、分步信息列表。
- 日常编辑器目前没有图片上传控件，也没有图片路径参数。

音频输入：

- Remotion Studio 中实现了音频拖拽导入。
- 音频文件写入`public/audio/`。
- 音轨信息写入`public/.vibe-motion/audio-tracks.json`。
- 这是 Studio 功能，不是日常编辑器页面中的图片或视频上传能力。

参数输入：

- 浏览器编辑器将`templateId`、`format`和`props`组成 JSON，提交给本地导出服务。
- 命令行也支持通过环境变量直接传 JSON，或读取一个 JSON 参数文件。

视频导出：

- 普通视频：H.264 MP4。
- 透明视频：ProRes 4444 MOV，使用 PNG 帧和透明像素格式。
- 输出保存到项目的`out/`目录。
- 文件名自动带时间，通常不会覆盖旧文件。
- 默认竖屏尺寸为1080×1920。

### 4. 对外接口

My-Motion 已有本地 HTTP 接口，监听：

```text
http://127.0.0.1:5174
```

接口包括：

- `GET /api/health`：健康检查
- `GET /api/export/status`：查询导出状态
- `POST /api/export`：提交导出任务
- `POST /api/open-output-folder`：打开输出文件夹

导出请求示例：

```json
{
  "format": "mp4",
  "templateId": "KeywordHighlight",
  "props": {
    "text": "示例文案",
    "keyword": "示例"
  }
}
```

限制：

- 只监听`127.0.0.1`，仅本机可访问。
- 请求体上限为64KB。
- 一次只能执行一个导出任务。
- 接口没有登录验证，因为它不是对公网开放的服务。
- 当前只接受三个固定模板及其参数，不接受图片文件上传。

### 5. 启动和调试方式

安装依赖：

```bash
pnpm install
```

启动完整应用：

```bash
pnpm run app
```

它会同时启动：

- 编辑器：`http://127.0.0.1:5173/`
- 导出服务：`http://127.0.0.1:5174/`

打开 Remotion Studio：

```bash
pnpm run dev
```

构建：

```bash
pnpm run build
pnpm run editor:build
```

检查：

```bash
pnpm run verify
```

命令行渲染：

```bash
pnpm run remotion:render
```

## 三、两个项目的对照结论

| 项目 | FramePilot | My-Motion |
|---|---|---|
| 主要用途 | 分析口播稿并生成 B-roll 方案与画面 | 制作文字和数字动效 |
| 前端 | React 18 + TypeScript | React 19 + JavaScript |
| 视频核心 | Remotion 4.0.410 | Remotion 4.0.438 |
| 图片输入 | 已支持，可多图上传 | 日常编辑器暂不支持 |
| 视频输入 | 支持 MP4、MOV、WebM 参考视频 | 日常编辑器暂不支持 |
| 音频输入 | 未发现正式音轨导入 | Studio 支持拖拽音频 |
| 配置输入 | React 状态、JSON文件 | 模板参数 JSON |
| 视频输出 | H.264 MP4 | H.264 MP4、透明 ProRes 4444 MOV |
| HTTP API | 没有 | 有，仅限本机 |
| 外部云服务 | 没有 | 没有 |

## 四、InkPilot 对接建议

### 推荐技术选择

InkPilot V0.1 建议使用 Node.js + TypeScript，继续做独立本地服务。

原因：

- 两个调用方都是 Node.js、React、Remotion 体系。
- 可以复用现有项目的安装、调试和进程管理经验。
- JSON 参数和本地文件路径的交接最直接。
- 不需要把 InkPilot 合并进任何一个现有项目。

### 推荐统一接口

InkPilot 对外提供本机 HTTP 接口，例如：

```text
POST http://127.0.0.1:5180/api/generate
GET  http://127.0.0.1:5180/api/jobs/:id
GET  http://127.0.0.1:5180/api/health
```

不要直接把大图片的 Base64 塞进 JSON。更合适的方式是：

- 上传接口使用`multipart/form-data`；
- 生成完成后返回透明 PNG 的本地文件路径、预览地址和元数据 JSON；
- FramePilot 和 My-Motion 只保存文件引用，不复制整张图片数据。

### FramePilot 的接入方式

FramePilot 改造较小：

1. 用户从现有“视觉素材池”上传图片。
2. 将图片发送给 InkPilot。
3. InkPilot 返回透明 PNG。
4. 把结果作为新的`VisualAsset`加入素材池。
5. 用户将它绑定到 B-roll 镜头，继续用 Remotion 预览和导出。

需要注意：现有图片以 Base64 Data URL 保存在浏览器内存和 JSON 中。接入 InkPilot 后建议改为保存本地文件路径或本地服务地址，避免配置文件过大。

### My-Motion 的接入方式

My-Motion 需要多一步改造：

1. 给需要图片的模板增加图片参数。
2. 在编辑器增加图片上传入口。
3. 图片先交给 InkPilot 生成透明 PNG。
4. 将结果保存到 My-Motion 的`public/`素材目录，或通过本地静态地址读取。
5. 将图片路径放进模板`props`，再交给现有导出接口。

现有`POST /api/export`不适合直接传图片，因为请求体只有64KB。应该新增独立素材上传接口，或只向导出接口传文件路径。

## 五、最终判断

- 第0步技术栈摸底已完成。
- InkPilot 继续作为独立服务的方案是正确的。
- Node.js + TypeScript 是两个项目之间阻力最小的共同技术栈。
- FramePilot 是第一优先接入方，因为它已经有图片素材池。
- My-Motion 可以第二阶段接入，需要先增加图片参数和上传入口。
- 目前不需要修改 FramePilot 或 My-Motion 的核心渲染架构。
