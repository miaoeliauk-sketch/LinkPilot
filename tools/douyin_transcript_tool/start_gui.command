#!/bin/bash
# 双击我启动「抖音视频逐字稿提取工具」
cd "$(dirname "$0")" || exit 1

if [ ! -x ".venv/bin/python" ]; then
  echo "❌ 还没安装。请先双击 install.command。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

.venv/bin/python douyin_transcript_gui.py || {
  echo ""
  echo "❌ 启动失败。可以先双击 install.command 重装一次，"
  echo "   还不行就把上面的报错截图发我。"
  read -r -p "按回车键关闭窗口..."
  exit 1
}
