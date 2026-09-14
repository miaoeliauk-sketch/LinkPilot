#!/bin/bash
# 双击我启动「扒抖音作品」
cd "$(dirname "$0")" || exit 1

PY=""
for c in python3.12 python3.11 python3.10 python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo "❌ 没找到 Python 3，请先安装：https://www.python.org/downloads/"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

"$PY" dy_gui.py || {
  echo ""
  echo "❌ 启动失败。如果提示缺少模块，请先双击 install.command 安装依赖。"
  read -r -p "按回车键关闭窗口..."
  exit 1
}
