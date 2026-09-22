#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抖音视频批量逐字稿提取工具

功能：
    从 links.txt 中读取抖音视频链接（一行一个），批量：
      1. 使用 yt-dlp 下载音频（mp3）
      2. 使用 Whisper（本地模型 或 OpenAI Whisper API）转写为文字
      3. 每条视频生成独立 txt 文件（带时间戳）
      4. 所有结果汇总为一份 Excel 表格

依赖安装：
    pip install yt-dlp openai-whisper openai pandas openpyxl requests dashscope opencc-python-reimplemented

    注：
      - 本地转写模式（--mode local）需要 openai-whisper 和 ffmpeg（用于音频处理）。
        ffmpeg 请自行通过系统包管理器安装（如 apt install ffmpeg / brew install ffmpeg）。
      - API 转写模式（--mode api）需要 openai 库以及有效的 API Key。
      - bailian 模式需要 dashscope 库。
      - yt-dlp 内部下载音频同样依赖 ffmpeg 完成到 mp3 的转码。

使用示例：
    # 本地模式，使用 small 模型，并发数 3
    python douyin_batch_transcript.py --links-file links.txt --output-dir ./output \
        --mode local --model-size small --concurrency 3

    # API 模式
    python douyin_batch_transcript.py --links-file links.txt --output-dir ./output \
        --mode api --api-key sk-xxxx --concurrency 5

    # 断点续传：直接重复运行同样的命令即可，已成功处理过的链接会自动跳过。
"""

import argparse
import logging
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse

# --------------------------------------------------------------------------
# 依赖检查：提前给出清晰的中文报错提示，而不是让程序在运行中途因 ImportError 崩溃
# --------------------------------------------------------------------------

MISSING_DEPS = []

try:
    import yt_dlp
except ImportError:
    yt_dlp = None
    MISSING_DEPS.append("yt-dlp")

try:
    import pandas as pd
except ImportError:
    pd = None
    MISSING_DEPS.append("pandas")

try:
    import openpyxl  # noqa: F401  # pandas 写 xlsx 需要它，这里仅用来提前探测是否安装
except ImportError:
    MISSING_DEPS.append("openpyxl")

# whisper / openai 是"按需依赖"：只有选用对应模式时才检查，
# 这样例如只想用 API 模式的用户不需要装本地 whisper 模型库（体积很大）。


# --------------------------------------------------------------------------
# 日志配置
# --------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("douyin_transcript")

# 保护多线程下终端输出、共享计数器、Excel结果列表、archive 文件的并发访问
PRINT_LOCK = threading.Lock()
PROGRESS_LOCK = threading.Lock()
ARCHIVE_LOCK = threading.Lock()
RESULTS_LOCK = threading.Lock()

_progress_done = 0
_progress_total = 0


def report_progress(link: str, status: str):
    global _progress_done
    with PROGRESS_LOCK:
        _progress_done += 1
        done, total = _progress_done, _progress_total
    with PRINT_LOCK:
        logger.info("进度 [%d/%d] %s -> %s", done, total, link, status)


# --------------------------------------------------------------------------
# 数据结构
# --------------------------------------------------------------------------

@dataclass
class TranscriptResult:
    link: str
    video_id: str = ""
    title: str = ""
    text: str = ""
    cover_path: str = ""
    video_path: str = ""
    status: str = "失败"  # "成功" / "失败"
    message: str = ""
    processed_at: str = field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S"))


# --------------------------------------------------------------------------
# 工具函数
# --------------------------------------------------------------------------

def sanitize_filename(name: str, max_len: int = 80) -> str:
    """把标题/ID 中的非法文件名字符替换掉，避免不同平台写文件报错。"""
    if not name:
        name = "untitled"
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", name).strip()
    name = re.sub(r"\s+", "_", name)
    if not name:
        name = "untitled"
    return name[:max_len]


def format_timestamp(seconds) -> str:
    """把秒数格式化成 mm:ss（超过一小时则 hh:mm:ss），用于逐字稿的时间戳标记。"""
    total = int(seconds or 0)
    m, s = divmod(total, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def format_timestamped_text(segments, fallback_text: str = "") -> str:
    """
    把转写返回的分段列表（每段带 start/end/text）格式化成"[mm:ss] 文本"这样每行一句的形式，
    方便对照回原视频。不是所有转写模式都能拿到分段信息（比如部分第三方 API 接口不支持返回
    时间戳），这种情况下 segments 会是空列表，直接退回普通的整段文字。
    """
    if not segments:
        return fallback_text
    lines = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        lines.append(f"[{format_timestamp(seg.get('start', 0))}] {text}")
    return "\n".join(lines) if lines else fallback_text


_URL_RE = re.compile(r"https?://[^\s]+")
_URL_TRAILING_PUNCT = "，。！？、；：''\"\"【】《》〈〉「」『』.,;:!?)\"'"
_DIRECT_MEDIA_EXT_RE = re.compile(r"\.(mp4|m3u8|mov|mkv|webm)(\?|$)", re.IGNORECASE)


_DOUYIN_PLAY_PATH_RE = re.compile(r"/aweme/v1/play(wm)?/", re.IGNORECASE)

# 抖音/字节的视频 CDN 域名。采集工具导出的"视频源网址"大多是这些域名下的地址，
# 路径里没有 .mp4 之类的后缀，光看后缀认不出来，只能按域名认。
_DOUYIN_MEDIA_HOST_SUFFIXES = (
    "douyinvod.com",
    "douyinstatic.com",
    "douyinpic.com",
    "ixigua.com",
    "bytecdn.cn",
    "byteimg.com",
    "pstatp.com",
    "zjcdn.com",
    "snssdk.com",
)


def is_douyin_media_url(url: str) -> bool:
    """
    判断是不是抖音的"视频源地址"——即视频文件本身，而不是作品详情页。

    两种形态都算：
      1. https://www.douyin.com/aweme/v1/play/?video_id=...
      2. https://v3-web.douyinvod.com/<一串路径>/?a=6383&ch=...  （CDN 直链，没有后缀）

    这类地址不走作品详情页那套风控，可以直接下载，正好绕开 yt-dlp 抖音解析器长期报
    "Fresh cookies (not necessarily logged in) are needed" 的问题。但它们要求请求头里带
    抖音的 Referer，否则 CDN 会直接返回 403 Forbidden。
    """
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    if host.endswith("douyin.com"):
        return bool(_DOUYIN_PLAY_PATH_RE.search(url))
    return any(host == s or host.endswith("." + s) for s in _DOUYIN_MEDIA_HOST_SUFFIXES)


def is_direct_media_url(url: str) -> bool:
    """
    判断一个链接是不是"直接指向视频文件本身"的地址（比如 .mp4/.m3u8 结尾，可能带一堆签名参数），
    而不是某个网站的作品详情页。这类链接可以跳过"某平台专用解析"，直接丢给 yt-dlp 的通用下载器
    （yt-dlp 自带的 Generic 提取器本来就是设计给这种场景用的：不认识网站没关系，只要是能直接
    访问到的媒体文件地址就能下载）。
    """
    return bool(_DIRECT_MEDIA_EXT_RE.search(url))


def extract_douyin_links(text: str) -> List[str]:
    """
    从任意一段文本里挑出抖音链接（或者直接指向视频文件本身的地址，见 is_direct_media_url），
    忽略标题、话题标签、"复制此链接..."提示语等其它内容。这样用户可以直接把 App 分享出来的
    整段文案粘贴进去，不用自己手动抠链接。去重时保留第一次出现的顺序。
    """
    links = []
    seen = set()
    for match in _URL_RE.finditer(text):
        url = match.group(0).rstrip(_URL_TRAILING_PUNCT)
        if ("douyin.com" not in url and not is_direct_media_url(url)
                and not is_douyin_media_url(url)):
            continue
        if url not in seen:
            seen.add(url)
            links.append(url)
    return links


def read_links(links_file: str) -> List[str]:
    if not os.path.isfile(links_file):
        raise FileNotFoundError(f"找不到链接文件：{links_file}，请确认路径是否正确。")
    with open(links_file, "r", encoding="utf-8") as f:
        lines = [line for line in f if not line.strip().startswith("#")]
    links = extract_douyin_links("\n".join(lines))
    if not links:
        raise ValueError(
            f"链接文件 {links_file} 中没有识别到任何抖音链接（或直接的视频文件地址）。"
            f"可以直接粘贴 App 分享出来的整段文案，程序会自动挑出链接。"
        )
    return links


def load_archive(archive_path: str) -> set:
    """加载已成功处理过的链接集合，用于断点续传。"""
    processed = set()
    if os.path.isfile(archive_path):
        with open(archive_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    processed.add(line)
    return processed


def append_archive(archive_path: str, link: str):
    with ARCHIVE_LOCK:
        with open(archive_path, "a", encoding="utf-8") as f:
            f.write(link + "\n")


def retry_with_backoff(func, *, retries: int, base_delay: float, what: str, link: str):
    """
    通用重试封装：失败后按 base_delay * (2 ** attempt) 递增等待再重试。
    重试耗尽后抛出最后一次的异常，由调用方决定如何记录失败。
    """
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            return func()
        except Exception as exc:  # noqa: BLE001 - 需要捕获各种下游库抛出的不同异常类型
            last_exc = exc
            if attempt < retries:
                delay = base_delay * (2 ** (attempt - 1))
                logger.warning(
                    "[%s] %s 第 %d 次尝试失败：%s，%.1f 秒后重试...",
                    link, what, attempt, exc, delay,
                )
                time.sleep(delay)
            else:
                logger.error("[%s] %s 重试 %d 次后仍然失败：%s", link, what, retries, exc)
    raise last_exc


# --------------------------------------------------------------------------
# 展开主页/合集链接为多个视频链接（yt-dlp）
# --------------------------------------------------------------------------

def expand_link_to_videos(
    link: str,
    cookies_from_browser: str = "",
    cookies_file: str = "",
) -> List[str]:
    """
    判断一个链接是"单个视频"还是"用户主页/合集"：
      - 如果是用户主页/合集，展开成该账号下所有视频的链接列表
      - 如果就是单个视频，原样返回 [link]

    用 extract_flat 模式只拉取列表信息、不真正下载，尽量减少请求开销。
    抖音主页可能需要 cookies 才能正常获取完整列表，用法同 download_audio。
    """
    if yt_dlp is None:
        raise RuntimeError("未安装 yt-dlp，请先运行: pip install yt-dlp")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "ignoreerrors": False,
    }
    if cookies_from_browser:
        ydl_opts["cookiesfrombrowser"] = (cookies_from_browser, None, None, None)
    if cookies_file:
        if not os.path.isfile(cookies_file):
            raise RuntimeError(f"找不到 cookies 文件：{cookies_file}，请确认路径是否正确。")
        ydl_opts["cookiefile"] = cookies_file

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(link, download=False)
    except Exception as exc:  # noqa: BLE001 - yt-dlp 不同版本对"不支持的链接"抛出的异常类型不完全一致
        raise RuntimeError(f"解析主页/链接失败（可能 yt-dlp 不支持这种主页链接格式）：{exc}") from exc

    if not isinstance(info, dict) or not info.get("entries"):
        # 不是主页/合集，就是单个视频，原样返回
        return [link]

    video_links = []
    for entry in info["entries"]:
        if not entry:
            continue
        url = entry.get("url") or entry.get("webpage_url")
        video_id = entry.get("id")
        if not url and video_id:
            url = f"https://www.douyin.com/video/{video_id}"
        if url:
            video_links.append(url)

    if not video_links:
        raise RuntimeError("识别到主页/合集，但没有拉取到任何视频，可能需要带上 --cookies-from-browser 才能看到完整列表。")

    return video_links


# --------------------------------------------------------------------------
# 下载音频（yt-dlp）
# --------------------------------------------------------------------------

def download_audio(
    link: str,
    output_dir: str,
    cookies_from_browser: str = "",
    cookies_file: str = "",
    keep_video_dir: Optional[str] = None,
) -> "tuple[str, str, str, str, Optional[str]]":
    """
    下载视频音频并转码为 mp3。默认只保留音频，不保留原始视频文件；如果传入
    keep_video_dir（一个目录路径），会额外把原始视频文件保留下来并移动到这个目录里
    （文件名形如 <视频ID>.mp4），方便需要连视频本身也下载下来的场景。

    返回 (mp3路径, 视频ID, 标题, 封面图链接, 视频文件路径)。封面图链接拿到的是抖音那边
    的图片地址，真正下载封面图请用 download_cover_image()；视频文件路径没有保留视频
    时是 None。

    yt-dlp 不同版本之间对 outtmpl / postprocessor 参数名基本保持稳定，
    但为了兼容旧/新版本可能出现的 info 字段差异，这里对 id/title 的读取做了容错。

    抖音近年加强了风控，很多情况下 yt-dlp 会报错
    "Fresh cookies (not necessarily logged in) are needed"，
    这时必须通过 --cookies-from-browser 或 --cookies-file 带上 cookies 才能下载。
    """
    if yt_dlp is None:
        raise RuntimeError("未安装 yt-dlp，请先运行: pip install yt-dlp")

    tmp_template = os.path.join(output_dir, "_audio_raw", "%(id)s.%(ext)s")
    os.makedirs(os.path.join(output_dir, "_audio_raw"), exist_ok=True)

    ydl_opts = {
        # 要保留视频文件的话，只下 bestaudio 拿不到画面，这里改成同时拉视频+音频合并
        "format": "bestvideo+bestaudio/best" if keep_video_dir else "bestaudio/best",
        "outtmpl": tmp_template,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": False,
        "retries": 3,
    }
    if keep_video_dir:
        # 提取完音频后不删除下载下来的原始视频文件
        ydl_opts["keepvideo"] = True
        ydl_opts["merge_output_format"] = "mp4"

    if is_douyin_media_url(link) or is_direct_media_url(link):
        # 已经是视频文件本身的地址了，不需要再走"某平台专用解析"。强制用 yt-dlp 的通用下载器，
        # 这样就绕开了抖音解析器（它长期报 "Fresh cookies ... are needed"，是 yt-dlp 上游
        # 尚未修复的问题）。抖音的播放源地址要求带上 Referer，否则会被拒绝。
        ydl_opts["force_generic_extractor"] = True
        ydl_opts["http_headers"] = {
            "Referer": "https://www.douyin.com/",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
            ),
        }

    if cookies_from_browser:
        # 格式为 (browser, keyring, profile, container)，其余位置留空即可
        ydl_opts["cookiesfrombrowser"] = (cookies_from_browser, None, None, None)
    if cookies_file:
        if not os.path.isfile(cookies_file):
            raise RuntimeError(f"找不到 cookies 文件：{cookies_file}，请确认路径是否正确。")
        ydl_opts["cookiefile"] = cookies_file

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(link, download=True)
    except yt_dlp.utils.DownloadError as exc:
        raise RuntimeError(f"yt-dlp 下载失败：{exc}") from exc
    except AttributeError as exc:
        # 兼容极旧/极新版本可能出现的属性缺失（例如 yt_dlp.utils.DownloadError 改名等）
        raise RuntimeError(f"yt-dlp 接口不兼容（可能是版本过旧或过新导致），请尝试升级：pip install -U yt-dlp。原始错误：{exc}") from exc

    if info is None:
        raise RuntimeError("yt-dlp 未返回视频信息，可能链接无效或视频已被删除/设为私密。")

    # 部分版本在下载播放列表/合集时会返回带 'entries' 的字典，这里只取第一个真实视频信息
    if isinstance(info, dict) and "entries" in info and info.get("entries"):
        entries = [e for e in info["entries"] if e]
        info = entries[0] if entries else info

    video_id = str(info.get("id") or "")
    title = str(info.get("title") or "")
    thumbnail_url = str(info.get("thumbnail") or "")

    if not video_id:
        # 极端兜底：用链接生成一个稳定的伪 ID，避免文件名冲突/为空
        video_id = re.sub(r"\W+", "_", link)[-32:]

    mp3_path = os.path.join(output_dir, "_audio_raw", f"{video_id}.mp3")
    if not os.path.isfile(mp3_path):
        # 有些版本转码后扩展名/路径处理略有差异，做一次兜底搜索
        candidate_dir = os.path.join(output_dir, "_audio_raw")
        found = None
        for fname in os.listdir(candidate_dir):
            if fname.startswith(video_id) and fname.endswith(".mp3"):
                found = os.path.join(candidate_dir, fname)
                break
        if found:
            mp3_path = found
        else:
            raise RuntimeError("音频转码后未找到 mp3 文件，请确认 ffmpeg 已正确安装且在 PATH 中。")

    video_path = None
    if keep_video_dir:
        candidate_dir = os.path.join(output_dir, "_audio_raw")
        for fname in os.listdir(candidate_dir):
            if fname.startswith(video_id) and not fname.endswith(".mp3"):
                src = os.path.join(candidate_dir, fname)
                ext = os.path.splitext(fname)[1] or ".mp4"
                try:
                    os.makedirs(keep_video_dir, exist_ok=True)
                    dest = os.path.join(keep_video_dir, f"{sanitize_filename(video_id)}{ext}")
                    shutil.move(src, dest)
                    video_path = dest
                except OSError as exc:
                    logger.warning("保留视频文件失败（不影响转写结果）：%s", exc)
                break

    return mp3_path, video_id, title, thumbnail_url, video_path


def download_cover_image(thumbnail_url: str, output_dir: str, video_id: str) -> Optional[str]:
    """
    下载视频封面图，保存到 output_dir 下（文件名形如 {video_id}_封面.jpg）。
    这一步失败不应该影响主流程（音频下载/转写才是核心功能），所以只记录警告并返回 None，
    不抛异常。
    """
    if not thumbnail_url:
        return None
    try:
        import requests
    except ImportError:
        logger.warning("未安装 requests，无法下载封面图。请运行: pip install requests")
        return None
    try:
        resp = requests.get(thumbnail_url, timeout=15)
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001 - 网络请求失败原因多样，这里统一按警告处理，不中断主流程
        logger.warning("下载封面图失败（不影响转写结果）：%s", exc)
        return None

    ext = ".jpg"
    content_type = resp.headers.get("Content-Type", "")
    if "png" in content_type:
        ext = ".png"
    elif "webp" in content_type:
        ext = ".webp"

    try:
        os.makedirs(output_dir, exist_ok=True)
        cover_path = os.path.join(output_dir, f"{sanitize_filename(video_id)}_封面{ext}")
        with open(cover_path, "wb") as f:
            f.write(resp.content)
    except OSError as exc:
        logger.warning("保存封面图失败（不影响转写结果）：%s", exc)
        return None

    return cover_path


# --------------------------------------------------------------------------
# 转写：本地 Whisper
# --------------------------------------------------------------------------

_local_model_cache = {}
_local_model_lock = threading.Lock()


def get_local_whisper_model(model_size: str):
    try:
        import whisper
    except ImportError as exc:
        raise RuntimeError(
            "未安装 openai-whisper，请先运行: pip install openai-whisper"
        ) from exc

    with _local_model_lock:
        if model_size not in _local_model_cache:
            logger.info("正在加载本地 Whisper 模型: %s（首次加载可能较慢，请耐心等待）...", model_size)
            try:
                _local_model_cache[model_size] = whisper.load_model(model_size)
            except Exception as exc:  # noqa: BLE001
                raise RuntimeError(
                    f"加载本地 Whisper 模型 '{model_size}' 失败：{exc}。"
                    f"请确认模型名称合法（tiny/base/small/medium/large），且网络可以下载模型权重。"
                ) from exc
        return _local_model_cache[model_size]


_PUNCTUATION_PROMPT = "以下是普通话的句子，请使用简体中文和标点符号（逗号、句号、问号）。"

# 提示词里那些会被回吐的词，按长度从长到短，逐个从结果里剔掉
_PROMPT_FRAGMENTS = sorted(
    ["以下是普通话的句子", "请使用简体中文和标点符号", "简体中文", "普通话",
     "标点符号", "句子", "逗号", "句号", "问号"],
    key=len, reverse=True,
)


def _is_prompt_echo(text: str) -> bool:
    """
    判断转写结果是不是"提示词的回声"。

    音频全静音时，Whisper 往往只会把 initial_prompt 拆碎了重复吐出来，例如
    "请使用简体中文和标点符号）逗号）逗号）。"。把提示词里的词和标点都剔掉之后，
    如果几乎什么都不剩，那这就不是真的转写内容。
    """
    if not text:
        return False
    rest = text
    hit = False
    for frag in _PROMPT_FRAGMENTS:
        if frag in rest:
            hit = True
            rest = rest.replace(frag, "")
    if not hit:
        # 没有一个提示词的影子，那再短也是真实内容（"好的。"这种）
        return False
    rest = re.sub(r"[\s，。、；：！？（）()【】\[\]…·~—\-]+", "", rest)
    return len(rest) <= 2


def transcribe_local(audio_path: str, model_size: str) -> "tuple[str, list]":
    """
    本地 Whisper 转写。这里做了两处针对中文短视频常见问题的调整：

    1. initial_prompt：给模型一句中文提示语，引导它主动加标点（逗号/句号），
       否则小模型转写中文经常是一整段没有断句的文字。
    2. condition_on_previous_text=False：默认情况下 Whisper 会把上一段解码出来
       的文字当作下一段的上下文，如果某一段音频是背景音乐/杂音/无人声（短视频剪辑
       里很常见），模型可能会"幻觉"出一整段无关内容（编造出跟视频完全无关的文字，
       甚至夹杂英文、泰文这种乱码），而且这种幻觉会顺着上下文一直带到后面的段落，
       导致后面大段文字都不对。关掉这个"带上下文"的选项，让每一段音频独立解码，
       能大幅减少这种幻觉互相传染、越转越离谱的情况。
    """
    model = get_local_whisper_model(model_size)
    try:
        result = model.transcribe(
            audio_path,
            language="zh",
            initial_prompt=_PUNCTUATION_PROMPT,
            condition_on_previous_text=False,
        )
    except TypeError:
        # 兼容某些旧版本 transcribe 不支持这些关键字参数的情况，逐步退回更基础的调用方式
        try:
            result = model.transcribe(audio_path, language="zh", condition_on_previous_text=False)
        except TypeError:
            try:
                result = model.transcribe(audio_path, language="zh")
            except TypeError:
                result = model.transcribe(audio_path)
    except RuntimeError as exc:
        raise RuntimeError(f"本地 Whisper 转写失败：{exc}") from exc
    text = result.get("text", "") if isinstance(result, dict) else str(result)
    text = text.strip()
    if _is_prompt_echo(text):
        # 音频是空的/全静音时，Whisper 会把 initial_prompt 原样（或碎片化地重复）吐回来，
        # 得到"请使用简体中文和标点符号）逗号）逗号）"这种垃圾。不拦住的话会被当成转写
        # 成功写进表格，比直接报错还糟——用户以为转好了，其实一个字都没有。
        raise RuntimeError(
            "转写结果只是提示词的回声，说明音频是空的或全静音（多半是视频没真正下载下来）。"
        )
    segments = []
    if isinstance(result, dict):
        for seg in result.get("segments", []) or []:
            segments.append({
                "start": seg.get("start", 0.0),
                "end": seg.get("end", 0.0),
                "text": (seg.get("text") or "").strip(),
            })
    return text, segments


# --------------------------------------------------------------------------
# 转写：OpenAI 兼容的 Whisper API（OpenAI 官方 / SiliconFlow / 其它兼容第三方）
# --------------------------------------------------------------------------

def _extract_api_segments(resp) -> list:
    """从 verbose_json 格式的响应里提取分段时间戳信息，兼容对象属性风格和 dict 风格两种返回。"""
    raw_segments = getattr(resp, "segments", None)
    if raw_segments is None and isinstance(resp, dict):
        raw_segments = resp.get("segments")
    segments = []
    for seg in raw_segments or []:
        if isinstance(seg, dict):
            start, end, text = seg.get("start", 0.0), seg.get("end", 0.0), seg.get("text", "")
        else:
            start = getattr(seg, "start", 0.0)
            end = getattr(seg, "end", 0.0)
            text = getattr(seg, "text", "")
        segments.append({"start": start, "end": end, "text": (text or "").strip()})
    return segments


def transcribe_api(
    audio_path: str,
    api_key: str,
    base_url: str = "",
    model: str = "whisper-1",
) -> "tuple[str, list]":
    """
    调用 OpenAI 风格的语音转写接口。通过 base_url 可以切换到任何"OpenAI 兼容"的
    第三方服务（例如 SiliconFlow：base_url=https://api.siliconflow.cn/v1，
    model 换成对应平台支持的语音识别模型名，比如 FunAudioLLM/SenseVoiceSmall）。
    不传 base_url 时默认走 OpenAI 官方接口。

    优先请求 verbose_json 格式，这样能顺带拿到分段时间戳；不是所有第三方服务都支持这个
    格式，不支持的话会自动退回普通的纯文字请求（此时没有时间戳信息）。
    """
    try:
        import openai
    except ImportError as exc:
        raise RuntimeError("未安装 openai 库，请先运行: pip install openai") from exc

    if not api_key:
        raise RuntimeError("使用 API 模式时必须通过 --api-key 传入 API Key。")

    # 兼容 openai>=1.0（client 风格）与 openai<1.0（旧的模块级函数风格）两套接口
    try:
        if hasattr(openai, "OpenAI"):
            client_kwargs = {"api_key": api_key}
            if base_url:
                client_kwargs["base_url"] = base_url
            client = openai.OpenAI(**client_kwargs)
            try:
                with open(audio_path, "rb") as f:
                    resp = client.audio.transcriptions.create(
                        model=model, file=f, response_format="verbose_json"
                    )
                text = getattr(resp, "text", None)
                if text is None and isinstance(resp, dict):
                    text = resp.get("text", "")
                segments = _extract_api_segments(resp)
            except Exception:  # noqa: BLE001 - 第三方接口不一定支持 verbose_json，退回普通模式
                with open(audio_path, "rb") as f:
                    resp = client.audio.transcriptions.create(model=model, file=f)
                text = getattr(resp, "text", None)
                if text is None and isinstance(resp, dict):
                    text = resp.get("text", "")
                segments = []
            return (text or "").strip(), segments
        else:
            openai.api_key = api_key
            if base_url:
                openai.api_base = base_url
            with open(audio_path, "rb") as f:
                resp = openai.Audio.transcribe(model, f)
            if isinstance(resp, dict):
                return (resp.get("text") or "").strip(), []
            return str(resp).strip(), []
    except Exception as exc:  # noqa: BLE001 - openai 库不同版本抛出的异常类型不完全一致
        raise RuntimeError(f"调用语音转写 API 失败：{exc}") from exc


# --------------------------------------------------------------------------
# 转写：阿里云百炼 / DashScope（Paraformer 实时语音识别，流式接口）
# --------------------------------------------------------------------------
#
# DashScope 的"文件转写"接口需要先把音频放到一个公网可访问的链接（通常是阿里云 OSS）
# 才能用，配置复杂。这里改用它的"实时语音识别"流式接口：把本地音频转成 16kHz 单声道
# PCM，直接分帧喂给 SDK，不需要任何额外的存储服务，只要一个 DashScope API Key 就够。
#
# 注意：这部分依赖 dashscope SDK 当前公开文档描述的调用方式（Recognition /
# RecognitionCallback），没有经过真实调用验证，如果 SDK 版本有出入可能需要调整。

def transcribe_bailian(
    audio_path: str,
    dashscope_api_key: str,
    model: str = "paraformer-realtime-v2",
) -> "tuple[str, list]":
    try:
        import dashscope
        from dashscope.audio.asr import Recognition, RecognitionCallback, RecognitionResult
    except ImportError as exc:
        raise RuntimeError("未安装 dashscope，请先运行: pip install dashscope") from exc

    if not dashscope_api_key:
        raise RuntimeError("使用 bailian 模式时必须通过 --dashscope-api-key 传入百炼/DashScope API Key。")

    dashscope.api_key = dashscope_api_key

    # 把 mp3 转成 16kHz 单声道 16bit PCM 裸数据，DashScope 实时识别接口要求这个格式
    pcm_path = audio_path + ".pcm"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", "-f", "s16le", pcm_path],
            check=True, capture_output=True,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("找不到 ffmpeg，请先安装 ffmpeg。") from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="ignore") if exc.stderr else str(exc)
        raise RuntimeError(f"用 ffmpeg 转换音频格式失败：{stderr}") from exc

    def _describe(result) -> str:
        """尽量把 dashscope 返回的错误/结果对象里所有能拿到的信息都掏出来，方便定位真实原因。"""
        parts = [repr(result)]
        for attr in ("message", "code", "status_code", "request_id", "reason"):
            value = getattr(result, attr, None)
            if value:
                parts.append(f"{attr}={value}")
        return " | ".join(parts)

    class _Callback(RecognitionCallback):
        def __init__(self):
            self.sentences = []
            self.segments = []
            self.error = None
            self.debug_lines = []

        def on_open(self):
            self.debug_lines.append("on_open：连接已建立")

        def on_close(self):
            self.debug_lines.append("on_close：连接已关闭")

        def on_complete(self):
            self.debug_lines.append("on_complete：识别正常结束")

        def on_error(self, result):  # noqa: D401
            self.error = _describe(result)
            self.debug_lines.append(f"on_error：{self.error}")

        def on_event(self, result):
            sentence = result.get_sentence()
            self.debug_lines.append(f"on_event：{sentence}")
            if sentence and sentence.get("text") and RecognitionResult.is_sentence_end(sentence):
                self.sentences.append(sentence["text"])
                self.segments.append({
                    "start": (sentence.get("begin_time") or 0) / 1000.0,
                    "end": (sentence.get("end_time") or 0) / 1000.0,
                    "text": sentence["text"],
                })

    callback = _Callback()
    recognition = Recognition(model=model, format="pcm", sample_rate=16000, callback=callback)

    try:
        recognition.start()
        # 给连接建立留一点时间，避免刚 start() 就立刻发数据导致时序问题
        time.sleep(0.5)
        chunk_size = 3200  # 约 100ms 音频（16kHz、16bit、单声道）
        with open(pcm_path, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                recognition.send_audio_frame(chunk)
                time.sleep(0.1)
        recognition.stop()
    except Exception as exc:  # noqa: BLE001
        debug_text = "；".join(callback.debug_lines) if callback.debug_lines else "（回调没有收到任何事件）"
        # 连接被服务端中断时，SDK 抛出的异常信息往往很笼统（比如 "Speech recognition has
        # stopped."），真正的原因通常在 on_error 回调里，优先把那个原因显示出来；
        # 附上完整的回调事件记录，方便判断到底是哪一步出的问题。
        if callback.error:
            raise RuntimeError(f"百炼实时语音识别返回错误：{callback.error}\n调用过程：{debug_text}") from exc
        raise RuntimeError(
            f"调用百炼实时语音识别失败：{type(exc).__name__}: {exc}\n调用过程：{debug_text}"
        ) from exc
    finally:
        if os.path.isfile(pcm_path):
            try:
                os.remove(pcm_path)
            except OSError:
                pass

    if callback.error:
        debug_text = "；".join(callback.debug_lines) if callback.debug_lines else "（回调没有收到任何事件）"
        raise RuntimeError(f"百炼实时语音识别返回错误：{callback.error}\n调用过程：{debug_text}")

    return "".join(callback.sentences).strip(), callback.segments


_t2s_converter = None
_t2s_converter_load_attempted = False


def to_simplified_chinese(text: str) -> str:
    """
    把繁体字统一转换成简体字。Whisper（不管本地模型还是各家 API）转写中文时，
    偶尔会输出繁体字或者简繁混杂，这里在返回给调用方之前统一转换一遍。
    依赖 opencc-python-reimplemented，没装的话就跳过转换、原样返回。
    """
    global _t2s_converter, _t2s_converter_load_attempted
    if not _t2s_converter_load_attempted:
        _t2s_converter_load_attempted = True
        try:
            import opencc
            _t2s_converter = opencc.OpenCC("t2s")
        except ImportError:
            logger.warning(
                "未安装 opencc-python-reimplemented，无法自动把繁体字转成简体字。"
                "如需要该功能，请运行: pip install opencc-python-reimplemented"
            )
    if _t2s_converter is None:
        return text
    return _t2s_converter.convert(text)


def is_opencc_available() -> bool:
    """给调用方（比如图形界面）提前查一下繁转简功能能不能用，方便在自己的日志/界面里提示，
    而不是只靠 logging 模块打印（图形界面不接入标准 logging，那样用户会看不到提示）。"""
    to_simplified_chinese("")  # 触发一次加载尝试（内部有缓存，不会重复加载）
    return _t2s_converter is not None


def transcribe_dispatch(audio_path: str, mode: str, args) -> "tuple[str, list]":
    """
    统一的转写入口，按 mode 分发到对应的实现。
    args 需要带上各模式所需的参数（model_size / api_key / api_base_url / api_model /
    dashscope_api_key 等），CLI 的 argparse Namespace 和 GUI 的一个简单参数对象都适用。

    返回 (纯文字, 分段列表)：分段列表每项是 {"start", "end", "text"}，用于生成带时间戳的
    逐字稿；不是所有模式/接口都能拿到分段信息，拿不到时是空列表，调用方应该对空列表做
    兜底（直接用纯文字）。
    """
    if mode == "local":
        text, segments = transcribe_local(audio_path, args.model_size)
    elif mode == "api":
        text, segments = transcribe_api(
            audio_path,
            args.api_key,
            base_url=getattr(args, "api_base_url", "") or "",
            model=getattr(args, "api_model", "") or "whisper-1",
        )
    elif mode == "bailian":
        text, segments = transcribe_bailian(audio_path, dashscope_api_key=args.dashscope_api_key)
    else:
        raise RuntimeError(f"未知的转写模式：{mode}")
    text = to_simplified_chinese(text)
    for seg in segments:
        seg["text"] = to_simplified_chinese(seg.get("text", ""))
    return text, segments


# --------------------------------------------------------------------------
# 单条链接处理流程
# --------------------------------------------------------------------------

def process_one_link(
    link: str,
    args,
    archive_path: str,
) -> TranscriptResult:
    result = TranscriptResult(link=link)

    # 随机延迟，降低触发抖音风控的概率
    delay = random.uniform(args.min_delay, args.max_delay)
    time.sleep(delay)

    audio_path = None
    try:
        audio_path, video_id, title, thumbnail_url, video_path = retry_with_backoff(
            lambda: download_audio(
                link,
                args.output_dir,
                cookies_from_browser=args.cookies_from_browser,
                cookies_file=args.cookies_file,
                keep_video_dir=args.output_dir if getattr(args, "keep_video", False) else None,
            ),
            retries=args.retries,
            base_delay=args.retry_base_delay,
            what="下载音频",
            link=link,
        )
        result.video_id = video_id
        result.title = title
        if video_path:
            result.video_path = video_path
    except Exception as exc:  # noqa: BLE001
        result.status = "失败"
        result.message = f"下载阶段失败：{exc}"
        report_progress(link, "失败（下载）")
        return result

    # 顺手下载封面图，失败也不影响后面的转写主流程
    cover_path = download_cover_image(thumbnail_url, args.output_dir, video_id)
    if cover_path:
        result.cover_path = cover_path

    try:
        text, segments = retry_with_backoff(
            lambda: transcribe_dispatch(audio_path, args.mode, args),
            retries=args.retries,
            base_delay=args.retry_base_delay,
            what=f"{args.mode}转写",
            link=link,
        )
        result.text = text
        result.status = "成功"
    except Exception as exc:  # noqa: BLE001
        result.status = "失败"
        result.message = f"转写阶段失败：{exc}"
        report_progress(link, "失败（转写）")
        return result
    finally:
        # 只保留文字稿，删除中间音频文件，节省磁盘空间
        if audio_path and os.path.isfile(audio_path) and args.keep_audio is False:
            try:
                os.remove(audio_path)
            except OSError:
                pass

    # 写单独的 txt 文件（带时间戳，拿不到分段信息时退回纯文字）
    base_name = sanitize_filename(result.video_id or result.title)
    txt_path = os.path.join(args.output_dir, f"{base_name}.txt")
    try:
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(format_timestamped_text(segments, fallback_text=result.text))
    except OSError as exc:
        result.message = f"转写成功但写入文件失败：{exc}"
        report_progress(link, "失败（写文件）")
        result.status = "失败"
        return result

    append_archive(archive_path, link)
    report_progress(link, "成功")
    return result


# --------------------------------------------------------------------------
# 汇总导出 Excel
# --------------------------------------------------------------------------

_ILLEGAL_EXCEL_CHARS_RE = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f]"
)


def clean_for_excel(value):
    """去掉 Excel/openpyxl 不允许写入的控制字符，避免报错（如 yt-dlp 报错信息里常见的 ANSI/控制字符）。"""
    if not isinstance(value, str):
        return value
    return _ILLEGAL_EXCEL_CHARS_RE.sub("", value)


def export_excel(results: List[TranscriptResult], output_dir: str):
    if pd is None:
        logger.error("未安装 pandas，无法生成汇总 Excel。请运行: pip install pandas openpyxl")
        return None

    rows = [
        {
            "视频链接": clean_for_excel(r.link),
            "视频ID": clean_for_excel(r.video_id),
            "转写文字": clean_for_excel(r.text),
            "封面图": clean_for_excel(r.cover_path),
            "视频文件": clean_for_excel(r.video_path),
            "转写状态": clean_for_excel(r.status),
            "处理时间": clean_for_excel(r.processed_at),
            "备注": clean_for_excel(r.message),
        }
        for r in results
    ]
    df = pd.DataFrame(rows)
    excel_path = os.path.join(output_dir, "汇总结果.xlsx")
    try:
        df.to_excel(excel_path, index=False, engine="openpyxl")
    except Exception as exc:  # noqa: BLE001
        logger.error("写入 Excel 汇总文件失败：%s", exc)
        return None
    return excel_path


def write_failure_list(results: List[TranscriptResult], output_dir: str):
    failures = [r for r in results if r.status != "成功"]
    if not failures:
        return None
    path = os.path.join(output_dir, "失败列表.txt")
    with open(path, "w", encoding="utf-8") as f:
        for r in failures:
            f.write(f"{r.link}\t{r.message}\n")
    return path


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="抖音视频批量逐字稿提取工具",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--links-file", required=True, help="链接文件路径，一行一个抖音视频链接")
    parser.add_argument("--output-dir", required=True, help="输出目录（txt 文件与汇总 Excel 都会放在这里）")
    parser.add_argument(
        "--mode",
        choices=["local", "api", "bailian"],
        default="local",
        help="转写模式：local=本地 Whisper 模型，api=OpenAI 兼容接口（官方或 SiliconFlow 等第三方），bailian=阿里云百炼/DashScope",
    )
    parser.add_argument("--model-size", default="small", choices=["tiny", "base", "small", "medium", "large"], help="本地模式下使用的 Whisper 模型大小")
    parser.add_argument("--api-key", default=os.environ.get("OPENAI_API_KEY", ""), help="api 模式下的 API Key（也可通过环境变量 OPENAI_API_KEY 设置）")
    parser.add_argument(
        "--api-base-url",
        default="",
        help="api 模式下的接口地址，不填默认走 OpenAI 官方。接第三方（如 SiliconFlow）时填对应 base_url，例如 https://api.siliconflow.cn/v1",
    )
    parser.add_argument(
        "--api-model",
        default="whisper-1",
        help="api 模式下使用的模型名，OpenAI 官方用 whisper-1；第三方服务需要换成对应平台支持的语音识别模型名",
    )
    parser.add_argument(
        "--dashscope-api-key",
        default=os.environ.get("DASHSCOPE_API_KEY", ""),
        help="bailian 模式下的阿里云百炼/DashScope API Key（也可通过环境变量 DASHSCOPE_API_KEY 设置）",
    )
    parser.add_argument("--concurrency", type=int, default=3, help="并发处理数（建议 3-5，避免抖音风控；本地模式若显存/内存有限请调低）")
    parser.add_argument("--retries", type=int, default=3, help="每个步骤失败后的最大重试次数")
    parser.add_argument("--retry-base-delay", type=float, default=2.0, help="重试的基础等待秒数（按指数递增：base, base*2, base*4...）")
    parser.add_argument("--min-delay", type=float, default=1.0, help="每个任务开始前的最小随机延迟（秒）")
    parser.add_argument("--max-delay", type=float, default=4.0, help="每个任务开始前的最大随机延迟（秒）")
    parser.add_argument("--keep-audio", action="store_true", help="保留中间下载的 mp3 音频文件（默认转写完成后删除）")
    parser.add_argument(
        "--keep-video", action="store_true",
        help="同时保留下载到的原始视频文件（保存到 <视频ID>.mp4），不只是提取出来的文字/音频",
    )
    parser.add_argument(
        "--cookies-from-browser",
        default="",
        help="当抖音提示需要登录/Cookies 时，从指定浏览器读取 Cookies，例如 chrome / safari / firefox / edge",
    )
    parser.add_argument(
        "--cookies-file",
        default="",
        help="当抖音提示需要登录/Cookies 时，指定一个 Netscape 格式的 cookies.txt 文件路径",
    )
    return parser


def main():
    parser = build_arg_parser()
    args = parser.parse_args()

    if MISSING_DEPS:
        logger.error(
            "缺少必要依赖：%s\n请先运行：pip install %s",
            ", ".join(MISSING_DEPS), " ".join(MISSING_DEPS),
        )
        sys.exit(1)

    if args.mode == "api" and not args.api_key:
        logger.error("api 模式下必须提供 --api-key，或设置环境变量 OPENAI_API_KEY。")
        sys.exit(1)

    if args.mode == "bailian" and not args.dashscope_api_key:
        logger.error("bailian 模式下必须提供 --dashscope-api-key，或设置环境变量 DASHSCOPE_API_KEY。")
        sys.exit(1)

    if args.concurrency < 1:
        logger.error("--concurrency 必须 >= 1")
        sys.exit(1)

    try:
        links = read_links(args.links_file)
    except (FileNotFoundError, ValueError) as exc:
        logger.error(str(exc))
        sys.exit(1)

    try:
        os.makedirs(args.output_dir, exist_ok=True)
    except OSError as exc:
        logger.error("无法创建输出目录 %s：%s", args.output_dir, exc)
        sys.exit(1)

    expanded_links = []
    for link in links:
        try:
            found = expand_link_to_videos(
                link,
                cookies_from_browser=args.cookies_from_browser,
                cookies_file=args.cookies_file,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[%s] 展开主页/合集失败，按单个视频处理：%s", link, exc)
            found = [link]
        if len(found) > 1:
            logger.info("[%s] 识别为主页/合集，展开为 %d 条视频链接。", link, len(found))
        expanded_links.extend(found)
    links = list(dict.fromkeys(expanded_links))  # 去重，保留首次出现的顺序

    archive_path = os.path.join(args.output_dir, "processed_archive.txt")
    processed = load_archive(archive_path)

    pending_links = [link for link in links if link not in processed]
    skipped_count = len(links) - len(pending_links)
    if skipped_count:
        logger.info("检测到断点续传记录，跳过已成功处理过的 %d 条链接。", skipped_count)

    if not pending_links:
        logger.info("所有链接均已处理完成，无需重复执行。")
        return

    global _progress_total
    _progress_total = len(pending_links)

    logger.info(
        "开始处理，共 %d 条待处理链接（总链接数 %d），模式=%s，并发数=%d",
        len(pending_links), len(links), args.mode, args.concurrency,
    )

    from concurrent.futures import ThreadPoolExecutor, as_completed

    all_results: List[TranscriptResult] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {
            executor.submit(process_one_link, link, args, archive_path): link
            for link in pending_links
        }
        for future in as_completed(futures):
            link = futures[future]
            try:
                result = future.result()
            except Exception as exc:  # noqa: BLE001 - 兜底：即使处理函数内部逻辑有漏网异常也不能让整体流程中断
                logger.error("[%s] 处理过程中发生未捕获异常：%s", link, exc)
                result = TranscriptResult(link=link, status="失败", message=f"未捕获异常：{exc}")
                report_progress(link, "失败（异常）")
            with RESULTS_LOCK:
                all_results.append(result)

    success_count = sum(1 for r in all_results if r.status == "成功")
    fail_count = len(all_results) - success_count
    logger.info("处理完成：成功 %d 条，失败 %d 条。", success_count, fail_count)

    excel_path = export_excel(all_results, args.output_dir)
    if excel_path:
        logger.info("汇总 Excel 已生成：%s", excel_path)

    failure_path = write_failure_list(all_results, args.output_dir)
    if failure_path:
        logger.info("失败链接列表已生成：%s", failure_path)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.warning("用户中断，已处理的部分结果不会丢失（断点续传记录已实时写入）。")
        sys.exit(130)
