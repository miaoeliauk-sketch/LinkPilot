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
echo ""
echo "正在安装依赖，请稍候（第一次大约 1~3 分钟）..."
echo ""

"$PY" -m pip install --upgrade pip
"$PY" -m pip install -r requirements.txt || {
  echo ""
  echo "❌ 依赖安装失败，请把上面的红色报错截图发给我。"
  read -r -p "按回车键关闭窗口..."
  exit 1
}

echo ""
echo "✅ 安装完成！"
echo ""
echo "下一步：双击 start_gui.command 打开程序，"
echo "        首次使用先点「重新扫码登录」。"
echo ""
read -r -p "按回车键关闭窗口..."
