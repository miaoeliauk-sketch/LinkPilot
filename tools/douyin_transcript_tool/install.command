#!/bin/bash
# 第一次使用：双击我，自动装好所有东西（只需要运行一次）
cd "$(dirname "$0")" || exit 1

echo "============================================"
echo "  抖音视频逐字稿提取工具 - 安装"
echo "============================================"
echo ""

fail() {
  echo ""
  echo "❌ $1"
  echo ""
  read -r -p "按回车键关闭窗口..."
  exit 1
}

# ---------- 1/4 找一个带图形界面模块的 Python ----------
echo "[1/4] 检查 Python ..."

CANDIDATES="python3.13 python3.12 python3.11 python3.10 python3 \
/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 \
/Library/Frameworks/Python.framework/Versions/3.12/bin/python3 \
/Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
/usr/bin/python3"

PY=""
FALLBACK=""
for c in $CANDIDATES; do
  command -v "$c" >/dev/null 2>&1 || continue
  [ -n "$FALLBACK" ] || FALLBACK="$c"
  if "$c" -c "import tkinter" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ] && [ -z "$FALLBACK" ]; then
  fail "没找到 Python 3。请到 https://www.python.org/downloads/ 下载安装（选 macOS 64-bit installer），然后再双击我。"
fi

if [ -z "$PY" ]; then
  VER=$("$FALLBACK" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null)
  echo ""
  echo "⚠️  你的 Python $VER 缺少图形界面模块 tkinter（Homebrew 版默认不带）。"
  echo ""
  if command -v brew >/dev/null 2>&1; then
    echo "    可以现在自动装上（大约十几秒）。"
    read -r -p "    要现在安装吗？[y/N] " ans
    case "$ans" in
      [yY]*)
        brew install "python-tk@$VER" || brew install python-tk || \
          fail "自动安装失败。请手动运行： brew install python-tk@$VER"
        echo ""
        echo "✅ 装好了，请再双击我一次继续。"
        echo ""
        read -r -p "按回车键关闭窗口..."
        exit 0
        ;;
    esac
  fi
  fail "请先运行： brew install python-tk@$VER    （装完再双击我）"
fi

echo "      使用 $($PY --version)"

# ---------- 2/4 ffmpeg（下载转码和本地转写都离不开它）----------
echo "[2/4] 检查 ffmpeg ..."
if command -v ffmpeg >/dev/null 2>&1; then
  echo "      已安装：$(ffmpeg -version 2>/dev/null | head -1 | cut -c1-40)"
else
  echo ""
  echo "⚠️  没装 ffmpeg。没有它没法把视频转成音频，工具跑不起来。"
  echo ""
  if command -v brew >/dev/null 2>&1; then
    read -r -p "    要现在自动安装吗？（大约 1~2 分钟）[y/N] " ans
    case "$ans" in
      [yY]*) brew install ffmpeg || fail "ffmpeg 安装失败，请手动运行： brew install ffmpeg" ;;
      *) fail "请先运行： brew install ffmpeg    （装完再双击我）" ;;
    esac
  else
    fail "请先装 Homebrew（https://brew.sh），再运行： brew install ffmpeg"
  fi
fi

# ---------- 3/4 Python 依赖（装在独立环境里，不动系统 Python）----------
echo "[3/4] 安装 Python 依赖 ..."
if [ ! -d ".venv" ]; then
  "$PY" -m venv .venv || fail "创建虚拟环境失败。"
fi
VPY=".venv/bin/python"

echo ""
echo "      注意：本地转写用的 Whisper 会顺带下载 PyTorch，有几百 MB，"
echo "      第一次装通常要 5~15 分钟，取决于网速。请耐心等，别关窗口。"
echo ""

"$VPY" -m pip install --upgrade pip || fail "升级 pip 失败。"
"$VPY" -m pip install -r requirements.txt || \
  fail "依赖安装失败，请把上面的红色报错截图发我。"

# ---------- 4/4 自检 ----------
echo ""
echo "[4/4] 自检 ..."
"$VPY" - <<'PYEOF' || exit 1
import importlib.util, shutil, sys
missing = [m for m in ("yt_dlp", "whisper", "openpyxl", "requests", "tkinter")
           if importlib.util.find_spec(m) is None]
if shutil.which("ffmpeg") is None:
    missing.append("ffmpeg(命令行)")
if missing:
    print("      ❌ 这些还是缺的：" + "、".join(missing))
    sys.exit(1)
print("      ✅ 全部就绪")
PYEOF

echo ""
echo "============================================"
echo "  ✅ 安装完成！"
echo "============================================"
echo ""
echo "  下一步：双击 start_gui.command 打开程序。"
echo ""
echo "  小提示：抖音经常改规则，如果哪天开始报下载失败，"
echo "  先双击 update.command 升级一下 yt-dlp。"
echo ""
read -r -p "按回车键关闭窗口..." || true
