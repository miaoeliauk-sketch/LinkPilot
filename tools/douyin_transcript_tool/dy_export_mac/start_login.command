#!/bin/bash
# 单独跑扫码登录（一般用不到，GUI 里的「重新扫码登录」按钮就够了）
cd "$(dirname "$0")" || exit 1

if [ ! -x ".venv/bin/python" ]; then
  echo "❌ 还没安装依赖。请先双击 install.command。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

.venv/bin/python dy_login.py
echo ""
read -r -p "按回车键关闭窗口..."
