#!/bin/bash
# 第一次使用：双击我，安装依赖（只需要运行一次）
cd "$(dirname "$0")" || exit 1

echo "===================================="
echo "  扒抖音作品 - 安装依赖"
echo "===================================="
echo ""

CANDIDATES="python3.13 python3.12 python3.11 python3.10 python3 \
/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
/Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
/usr/bin/python3"

# 优先挑一个「自带图形界面模块 tkinter」的 Python
PY=""
FALLBACK=""
for c in $CANDIDATES; do
  command -v "$c" >/dev/null 2>&1 || continue
  [ -n "$FALLBACK" ] || FALLBACK="$c"
  if "$c" -c "import tkinter" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ] && [ -z "$FALLBACK" ]; then
  echo "❌ 没找到 Python 3。请到这里下载安装（选 macOS 64-bit installer）："
  echo "   https://www.python.org/downloads/"
  echo ""
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

if [ -z "$PY" ]; then
  # 找到了 Python，但都不带 tkinter。给出对得上版本号的安装命令
  VER=$("$FALLBACK" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)
  echo ""
  echo "⚠️  你的 Python $VER 缺少图形界面模块 tkinter（Homebrew 版默认不带）。"
  echo ""
  echo "    两个办法，任选一个："
  echo ""
  echo "    办法 A（推荐，快）：终端里运行"
  echo "        brew install python-tk@$VER"
  echo "      如果提示找不到这个包，就试不带版本号的："
  echo "        brew install python-tk"
  echo ""
  echo "    办法 B：去官网装一个自带图形界面的 Python"
  echo "        https://www.python.org/downloads/"
  echo ""
  echo "    弄好以后，再双击我一次就行。"
  echo ""
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

echo "使用 Python: $($PY --version)  ($PY)"

# 建独立虚拟环境，避免 macOS 的 PEP 668「externally-managed-environment」报错
echo ""
echo "正在创建独立运行环境 .venv ..."
if [ ! -d ".venv" ]; then
  "$PY" -m venv .venv || {
    echo "❌ 创建虚拟环境失败。"
    read -r -p "按回车键关闭窗口..."
    exit 1
  }
fi

VPY=".venv/bin/python"

echo ""
echo "正在安装依赖，请稍候（第一次大约 1~3 分钟）..."
echo ""

"$VPY" -m pip install --upgrade pip
"$VPY" -m pip install -r requirements.txt || {
  echo ""
  echo "❌ 依赖安装失败，请把上面的红色报错截图发给我。"
  read -r -p "按回车键关闭窗口..."
  exit 1
}

# 扫码登录用的浏览器。有系统 Chrome 就直接用，没有才下载 Chromium
echo ""
if [ -d "/Applications/Google Chrome.app" ]; then
  echo "✅ 检测到系统 Chrome，扫码登录会直接用它。"
else
  echo "没检测到 Chrome，正在下载扫码登录用的浏览器（约 150MB）..."
  "$VPY" -m playwright install chromium || \
    echo "⚠️  浏览器下载失败。装个 Google Chrome 也可以，不影响其它功能。"
fi

echo ""
echo "✅ 安装完成！"
echo ""
echo "下一步：双击 start_gui.command 打开程序，"
echo "        首次使用先点「重新扫码登录」。"
echo ""
read -r -p "按回车键关闭窗口..."
