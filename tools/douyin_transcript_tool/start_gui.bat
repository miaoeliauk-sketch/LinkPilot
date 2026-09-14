@echo off
chcp 65001 >nul
REM 双击这个文件就能直接启动"抖音视频逐字稿提取工具"图形界面，
REM 不用再自己打开命令提示符、cd 到文件夹、敲 python 命令了。
REM
REM 如果双击后提示"找不到 python"或者一闪而过，说明还没装 Python，
REM 或者装的时候没有勾选"Add python.exe to PATH"，需要重新安装一次并勾选这个选项。

cd /d "%~dp0"

echo 正在启动抖音视频逐字稿提取工具，请稍候...
python douyin_transcript_gui.py

if errorlevel 1 (
    echo.
    echo 程序异常退出，上面的报错信息可以截图发给 Claude 帮忙看。
)

echo.
pause
