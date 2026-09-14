# -*- coding: utf-8 -*-
"""
抖音主页作品批量导出 -> 大圣.xlsx 同款 50 列 Excel
用法: python3 dy_export.py <主页链接或sec_user_id> [输出.xlsx]

这是从 Windows 版移植过来的 Mac 版本，核心抓取逻辑跟 Windows 版完全一样，
没有改动；BASE_PARAMS 里那些 "Windows"/"Win32" 字样是发给抖音服务器的
伪装浏览器信息（让抖音以为是 Windows 上的 Chrome 在访问），跟你实际用的
是不是 Mac 没关系，不用改。
"""
import asyncio, json, os, re, sys, time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

# 数据目录（cookie / 输出）按这个顺序确定：
#   1. 启动器指定的 DY_BASE —— 便携版运行时走这条，输出落在发布包根目录
#   2. 打包成可执行文件后跟随可执行文件所在目录
#   3. 平常开发跟随源码目录
_ov = os.environ.get("DY_BASE")
if _ov:
    BASE = Path(_ov)
elif getattr(sys, "frozen", False):
    BASE = Path(sys.executable).parent
else:
    BASE = Path(__file__).parent
sys.path.insert(0, str(Path(__file__).parent))  # 模块都放在程序目录下

from curl_cffi.requests import Session, get as curl_get
from signer import sign_url
from openpyxl import Workbook

COOKIE_FILE = BASE / "cookie.txt"
OUT_DIR = BASE / "输出"

HEADERS = {
    "Accept": "*/*",
    "Accept-Encoding": "*/*",
    "Referer": "https://www.douyin.com/?recommend=1",
}
IMPERSONATE = "chrome146"

ILLEGAL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

BASE_PARAMS = {
    "device_platform": "webapp",
    "aid": "6383",
    "channel": "channel_pc_web",
    "update_version_code": "170400",
    "pc_client_type": "1",
    "support_h265": "1",
    "support_dash": "1",
    "version_code": "290100",
    "version_name": "29.1.0",
    "cookie_enabled": "true",
    "screen_width": "1536",
    "screen_height": "864",
    "browser_language": "zh-CN",
    "browser_platform": "Win32",
    "browser_name": "Chrome",
    "browser_version": "146.0.0.0",
    "browser_online": "true",
    "engine_name": "Blink",
    "engine_version": "146.0.0.0",
    "os_name": "Windows",
    "os_version": "10",
    "cpu_core_num": "16",
    "device_memory": "8",
    "platform": "PC",
    "downlink": "10",
    "effective_type": "4g",
    "round_trip_time": "200",
    "uifid": "",
    "msToken": "",
}

HEADERS_50 = [
    "是否选择", "序号", "作品id", "作品类型", "提取类型", "搜索关键词", "搜索话题",
    "收藏夹名称", "作品作者", "作者粉丝数量", "作品标题", "合集名称", "播放量",
    "点赞量", "评论量", "收藏量", "分享量", "作品质量", "作品时长", "作品网址",
    "发布时间", "作者主页", "是否全屏", "是否购物车", "有无本地生活", "主页备注",
    "合集备注", "关键词备注", "作品备注", "作者uid", "作者secUid", "封面网址",
    "购物车信息", "商品ID", "商品标题", "本地生活信息展示", "本地生活信息",
    "DisableDownload", "视频源网址", "音频源网址", "视频下载网址列表", "图文下载网址",
    "图文音乐下载网址", "video_id", "作品时长秒", "话题内容", "下载状态", "保存路径",
    "是否已经语音转写文案", "是否会员作品",
]


def load_cookie() -> str:
    txt = COOKIE_FILE.read_text(encoding="utf-8").strip()
    if not txt:
        raise RuntimeError("cookie.txt 为空，请先运行 dy_login.py 扫码登录")
    return txt


def resolve_link(link: str) -> dict:
    """支持: sec_user_id / 主页链接 / 分享短链 / 单作品链接 / 带文案的整段分享文本"""
    link = link.strip()
    # 1) 直接给了 sec_user_id（完整长度）
    m = re.search(r"(MS4wLjAB[A-Za-z0-9_-]{30,})", link)
    if m:
        return {"sec_user_id": m.group(1)}
    # 2) 完整主页链接
    m = re.search(r"douyin\.com/user/(MS4wLjAB[A-Za-z0-9_-]+)", link)
    if m:
        return {"sec_user_id": m.group(1)}
    # 3) 单作品链接
    m = re.search(r"douyin\.com/(?:video|note)/(\d+)", link)
    if m:
        return {"aweme_id": m.group(1)}
    # 4) 分享短链（从任意文案中抠出短码；分享文案常把短码用空格拆断，需拼回）
    m = re.search(r"(?:v\.douyin\.com|iesdouyin\.com/share/[a-z]+)/([A-Za-z0-9_-]+)", link)
    if m:
        code = m.group(1)
        candidates = [code]
        tail = re.search(r"v\.douyin\.com/[A-Za-z0-9_-]+\s+([A-Za-z0-9_-]{1,4})/?(\s|$)", link)
        if tail:
            candidates.insert(0, code + tail.group(1))
        ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"}
        for cd in candidates:
            try:
                r = curl_get(f"https://v.douyin.com/{cd}", allow_redirects=False,
                             timeout=15, verify=False, headers=ua)
            except Exception:
                continue
            loc = r.headers.get("Location") or ""
            mm = (re.search(r"(MS4wLjAB[A-Za-z0-9_-]{30,})", loc)
                  or re.search(r"iesdouyin\.com/share/(?:video|note)/(\d+)", loc)
                  or re.search(r"douyin\.com/(?:video|note)/(\d+)", loc))
            if mm:
                g = mm.group(1)
                return {"sec_user_id": g} if g.startswith("MS4w") else {"aweme_id": g}
        raise RuntimeError(f"短链解析失败（试过: {candidates}），请确认链接完整后重试")
    raise RuntimeError("没找到链接：请粘贴包含 v.douyin.com 或 douyin.com/user/ 的内容")


class DouyinClient:
    def __init__(self, cookie: str):
        self.cookie = cookie
        self.session = Session(timeout=20, impersonate=IMPERSONATE)
        self.headers = HEADERS | {"Cookie": cookie}

    def get_json(self, path: str, extra: dict) -> dict:
        url = f"https://www.douyin.com{path}"
        signed = sign_url(url, BASE_PARAMS | extra)
        r = self.session.get(signed, headers=self.headers, verify=False)
        r.raise_for_status()
        return r.json()

    def user_profile(self, sec_user_id: str) -> dict:
        d = self.get_json("/aweme/v1/web/user/profile/other/", {
            "publish_video_strategy_type": "2",
            "source": "channel_pc_web",
            "sec_user_id": sec_user_id,
            "personal_center_strategy": "1",
            "profile_other_record_enable": "1",
            "land_to": "1",
        })
        return d.get("user", {})

    def aweme_detail(self, aweme_id: str) -> dict:
        d = self.get_json("/aweme/v1/web/aweme/detail/", {"aweme_id": aweme_id})
        return d.get("aweme_detail", {})

    def user_posts(self, sec_user_id: str, max_pages: int = 200):
        cursor, pages = 0, 0
        while pages < max_pages:
            d = self.get_json("/aweme/v1/web/aweme/post/", {
                "sec_user_id": sec_user_id,
                "max_cursor": cursor,
                "count": "20",
                "locate_query": "false",
                "show_live_replay_strategy": "1",
                "need_all_list": "false",
                "publish_video_strategy_type": "2",
            })
            aweme_list = d.get("aweme_list") or []
            yield aweme_list
            pages += 1
            if d.get("has_more") in (0, False) or not aweme_list:
                break
            cursor = d.get("max_cursor") or 0
            time.sleep(1.2)


def fmt_duration(ms: int) -> str:
    s = int((ms or 0) / 1000)
    return f"{s // 60}分{s % 60}秒" if s else "0秒"


def pick_quality(aweme: dict) -> str:
    br = (aweme.get("video") or {}).get("bit_rate") or []
    gears = [b.get("gear_name") for b in br if b.get("gear_name")]
    if gears:
        order = [" Adapt_", "adapt_540", "adapt_720", "adapt_1080"]
        for key in ("1080p", "720p", "540p"):
            for g in gears:
                if key in g:
                    return key
    return ""


def build_play_url(aweme: dict) -> str:
    video = aweme.get("video") or {}
    uri = (video.get("play_addr") or {}).get("uri", "")
    if uri:
        ratio = "1080p" if "1080" in pick_quality(aweme) else "540p"
        return f"https://www.douyin.com/aweme/v1/play/?video_id={uri}&ratio={ratio}&line=0"
    urls = (video.get("play_addr") or {}).get("url_list") or []
    return urls[0] if urls else ""


def row_from_aweme(i: int, aweme: dict, author_info: dict) -> list:
    aweme_id = str(aweme.get("aweme_id", ""))
    is_image = bool(aweme.get("images"))
    aweme_type = "图文" if is_image else "视频"
    url_path = "note" if is_image else "video"
    video = aweme.get("video") or {}
    stats = aweme.get("statistics") or {}
    author = aweme.get("author") or {}
    create_time = datetime.fromtimestamp(int(aweme.get("create_time") or 0)).strftime("%Y-%m-%d %H:%M:%S")
    topics = [t.get("hashtag_name", "") for t in (aweme.get("text_extra") or []) if t.get("hashtag_name")]
    quality = pick_quality(aweme)
    play_url = build_play_url(aweme)
    music_urls = ((aweme.get("music") or {}).get("play_url") or {}).get("url_list") or []
    br_map = {}
    for b in (video.get("bit_rate") or []):
        gear = b.get("gear_name") or ""
        for key in ("1080p", "720p", "540p"):
            if key in gear and b.get("play_addr", {}).get("url_list"):
                br_map[key] = b["play_addr"]["url_list"][0]
                break
    image_urls = [img.get("url_list", [""])[0] for img in (aweme.get("images") or [])]
    cover_urls = (video.get("cover") or {}).get("url_list") or []
    if is_image and image_urls:
        cover_urls = cover_urls or image_urls[:1]

    return [
        "True", str(i), aweme_id, aweme_type, "主页", "", "", "",
        author.get("nickname", author_info.get("nickname", "")),
        str(author_info.get("follower_count", 0) or 0),
        aweme.get("desc", ""), (aweme.get("mix") or {}).get("mix_name", ""),
        "0",
        str(stats.get("digg_count", 0)), str(stats.get("comment_count", 0)),
        str(stats.get("collect_count", 0)), str(stats.get("share_count", 0)),
        quality, fmt_duration(video.get("duration", 0)),
        f"https://www.douyin.com/{url_path}/{aweme_id}",
        create_time,
        f"https://www.douyin.com/user/{author.get('sec_uid', '')}",
        "否", "无", "无", "默认", "默认", "默认", "默认",
        str(author.get("uid", author_info.get("uid", ""))),
        author.get("sec_uid", author_info.get("sec_uid", "")),
        cover_urls[0] if cover_urls else "",
        "", "", "", "", "",
        "False",
        play_url,
        music_urls[0] if music_urls else "",
        json.dumps(br_map, ensure_ascii=False),
        json.dumps(image_urls, ensure_ascii=False) if is_image else "[]",
        "",
        (video.get("play_addr") or {}).get("uri", ""),
        str(int((video.get("duration") or 0) / 1000)),
        ",".join(topics),
        "0%", "", "False", "False",
    ]


def main():
    if len(sys.argv) < 2:
        print("用法: python3 dy_export.py <主页链接或sec_user_id> [输出.xlsx]")
        sys.exit(1)
    target = resolve_link(sys.argv[1])
    cookie = load_cookie()
    client = DouyinClient(cookie)

    if "aweme_id" in target:
        aweme = client.aweme_detail(target["aweme_id"])
        sec = (aweme.get("author") or {}).get("sec_uid")
        target = {"sec_user_id": sec}

    profile = client.user_profile(target["sec_user_id"])
    author_info = {
        "nickname": profile.get("nickname", ""),
        "sec_uid": profile.get("sec_uid", target["sec_user_id"]),
        "uid": profile.get("uid", ""),
        "follower_count": ((profile.get("follower_count") or 0)),
    }
    print(f"作者: {author_info['nickname']} | 粉丝: {author_info['follower_count']}", flush=True)

    rows, i = [], 0
    for batch in client.user_posts(target["sec_user_id"]):
        for aweme in batch:
            i += 1
            row = row_from_aweme(i, aweme, author_info)
            rows.append([ILLEGAL_CHARS.sub("", v) if isinstance(v, str) else v for v in row])
        print(f"已抓取 {i} 条作品...", flush=True)

    OUT_DIR.mkdir(exist_ok=True)
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else OUT_DIR / f"作品列表_{author_info['nickname']}_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "作品列表"
    ws.append(HEADERS_50)
    for r in rows:
        ws.append(r)
    wb.save(out)
    print(f"DONE: {len(rows)} 条作品 -> {out}", flush=True)


if __name__ == "__main__":
    main()
