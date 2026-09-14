# 扒抖音作品（Mac 版）

把抖音博主主页的**全部作品**一次性抓下来，导出成 50 列的 Excel。
导出的 Excel 可以直接喂给上层目录的逐字稿转写工具（Excel 模式）。

原版是 Windows 专用的，这是 Mac 适配版。

---

## 一、第一次使用（只做一次）

1. 把整个 `dy_export_mac` 文件夹拖到你想放的地方
   （**路径里不要有中文**，否则某些第三方终端会报"no such file or directory"）
2. 双击 **`install.command`** → 自动装依赖，等它显示"✅ 安装完成"
   （会在文件夹里建一个 `.venv` 独立环境，不会动你系统里的 Python）
3. 双击 **`start_gui.command`** → 打开程序窗口
4. 点 **「重新扫码登录」** → 会弹出 Chrome → 用手机抖音扫码登录
   → 登录成功后会自动生成 `cookie.txt`，窗口自己关掉

> 如果双击 `.command` 提示"无法打开，因为来自身份不明的开发者"：
> 右键点它 → 选「打开」→ 再点「打开」。或者在终端里跑一次
> `chmod +x *.command`。

---

## 二、日常使用

1. 双击 `start_gui.command`
2. 抖音 App → 博主主页 → 分享 → 复制链接 → 粘贴到输入框
   （整段分享文案直接粘也行，会自动识别）
3. 点「开始扒取」，等进度跑完
4. 点「打开 Excel」，文件在 `输出/` 文件夹里

速度约 20 条/秒，1400 条作品大概 2~3 分钟。

---

## 三、Mac 版改了什么

| 原版（Windows） | Mac 版 |
|---|---|
| `os.startfile()` 打开文件/文件夹 | 换成跨平台的 `open`（Mac）/ `xdg-open`（Linux） |
| Playwright 固定用 `channel="msedge"` | 优先用系统的 Chrome，失败依次退回 Edge、Playwright 自带 Chromium |
| 字体 `Microsoft YaHei` / `Consolas` | 换成 `PingFang SC` / `Menlo`，字号整体 +2 |
| `.bat` 启动器 + 打包的 `runtime\python.exe` | `.command` 启动器 + 自建 `.venv` 独立环境 |
| 抓取失败只写在日志里 | 额外弹窗提示 |

`dy_export.py` 和 `signer.py` 的抓取逻辑**没动**，和原版完全一样。

> 注意：`signer.py` 里的 UA 和 `dy_export.py` 里 `BASE_PARAMS` 的
> `os_name: Windows` / `browser_platform: Win32` 是**发给抖音服务器的浏览器指纹**，
> 跟你本机是不是 Mac 无关，两边必须一致，不要改。

---

## 四、常见问题

**装依赖时报 `externally-managed-environment`**
新版脚本已经用 `.venv` 独立环境绕开了这个问题。如果你还看到这个报错，
说明你用的是旧版 `install.command`，换成新的再跑一次。

**报错说缺少 `tkinter`**
Homebrew 装的 Python 默认不带图形界面模块。脚本会告诉你**对得上版本号**的命令，
比如 Python 3.12 就是：
```
brew install python-tk@3.12
```
装完重新双击 `install.command` 即可。
（注意：不带版本号的 `brew install python-tk` 装的可能是另一个 Python 版本的，对不上号就没用。）

也可以改用[官网的 Python](https://www.python.org/downloads/)，它自带图形界面模块，
装完脚本会自动优先选它。

**「一条作品都没抓到」**
登录过期了，点「重新扫码登录」重新扫一次。

**弹不出浏览器 / 提示没有可用浏览器**
先装 Google Chrome。实在不行在终端里跑：
```
python3 -m playwright install chromium
```

**`cookie.txt` 是什么**
是你的抖音登录凭证，只在本机用，**不要发给任何人**、不要传到网上。

---

## 五、和逐字稿工具怎么配合

这里导出的 Excel 是标准 50 列格式，直接在上层目录的
`douyin_transcript_gui.py`（图形界面）里选「Excel 模式」，
把这个 xlsx 拖进去就能批量转写。
