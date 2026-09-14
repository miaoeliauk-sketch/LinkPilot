#!/bin/bash
# 第一次使用：双击我，安装依赖（只需要运行一次）
cd "$(dirname "$0")" || exit 1

echo "===================================="
echo "  扒抖音作品 - 安装依赖"
echo "===================================="
echo ""

PY=""
for c in python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo "❌ 没找到 Python 3。请先安装：https://www.python.org/downloads/"
  echo ""
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

echo "使用 Python: $($PY --version)"

# 检查 tkinter（图形界面必需，Homebrew 的 python 默认不带）
if ! "$PY" -c "import tkinter" >/dev/null 2>&1; then
  echo ""
  echo "⚠️  这个 Python 缺少图形界面模块 tkinter。"
  echo "    请在终端里运行下面这行装上，然后再双击我一次："
  echo ""
  echo "        brew install python-tk"
  echo ""
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

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
