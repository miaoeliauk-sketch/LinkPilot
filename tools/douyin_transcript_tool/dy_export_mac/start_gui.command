#!/bin/bash
# 双击我启动「扒抖音作品」
cd "$(dirname "$0")" || exit 1

if [ ! -x ".venv/bin/python" ]; then
  echo "❌ 还没安装依赖。请先双击 install.command。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

.venv/bin/python dy_gui.py || {
  echo ""
  echo "❌ 启动失败。可以先双击 install.command 重装一次依赖，"
  echo "   如果还不行，把上面的报错截图发我。"
  read -r -p "按回车键关闭窗口..."
  exit 1
}
