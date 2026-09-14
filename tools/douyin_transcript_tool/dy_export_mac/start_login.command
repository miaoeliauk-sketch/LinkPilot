#!/bin/bash
# 单独跑扫码登录（一般用不到，GUI 里的「重新扫码登录」按钮就够了）
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

"$PY" dy_login.py
echo ""
read -r -p "按回车键关闭窗口..."
