#!/bin/bash
# 双击这个文件就能直接启动"抖音视频逐字稿提取工具"图形界面，
# 不用再自己打开终端、cd 到文件夹、敲 python3 命令了。
#
# 第一次双击时，macOS 可能会提示"无法打开，因为无法验证开发者"，
# 这时候不要直接双击，改成：右键点这个文件 -> 选"打开" -> 弹窗里再点一次"打开"，
# 这样点一次以后，以后就可以正常双击了。

cd "$(dirname "$0")"

echo "正在启动抖音视频逐字稿提取工具，请稍候..."
python3 douyin_transcript_gui.py

status=$?
if [ $status -ne 0 ]; then
    echo ""
    echo "程序异常退出（错误码 $status），上面的报错信息可以截图发给 Claude 帮忙看。"
fi

echo ""
read -p "按回车键关闭这个窗口..."
