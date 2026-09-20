#!/bin/bash
# 抖音改规则导致下载失败时，双击我升级 yt-dlp
cd "$(dirname "$0")" || exit 1

if [ ! -x ".venv/bin/python" ]; then
  echo "❌ 还没安装。请先双击 install.command。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

echo "正在升级 yt-dlp ..."
echo ""
.venv/bin/python -m pip install --upgrade yt-dlp
echo ""
echo "当前版本：$(.venv/bin/python -m yt_dlp --version 2>/dev/null)"
echo ""
read -r -p "按回车键关闭窗口..."
