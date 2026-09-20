# -*- coding: utf-8 -*-
"""
直接调抖音网页接口，为某条作品**现取**一个新的播放地址。

为什么需要这个模块：
    采集工具导出的表格里那列"视频源网址"是带签名的临时地址，URL 里的 x-expires 就是
    到期时间戳，寿命通常只有几小时到一天。表格放一晚上再来转写，地址全部失效，下载
    一律 403 Forbidden——这跟请求头、cookies 都没关系，地址本身已经作废了。

    所以正确做法不是把地址存进表格，而是在**下载前的那一刻**用作品 id 现要一个。

签名说明：
    抖音的网页接口要求 URL 上带一个 a_bogus 签名参数，否则直接拒绝。这里用 f2
    （Apache-2.0）的 ABogusManager 生成。日后抖音改算法导致失效，只需要改 sign_url。
"""
import json
import re
from typing import Optional
from urllib.parse import urlparse

try:
    from curl_cffi.requests import Session as _CurlSession
except ImportError:
    _CurlSession = None

try:
    from f2.apps.douyin.utils import ABogusManager
except ImportError:
    ABogusManager = None


# 这里的 Windows / Win32 是发给抖音服务器的浏览器指纹，跟你本机是不是 Mac 无关，
# 而且必须和下面 UA 里写的保持一致，不要改。
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")

IMPERSONATE = "chrome131"

BASE_PARAMS = {
    "device_platform": "webapp", "aid": "6383", "channel": "channel_pc_web",
    "update_version_code": "170400", "pc_client_type": "1", "support_h265": "1",
    "support_dash": "1", "version_code": "290100", "version_name": "29.1.0",
    "cookie_enabled": "true", "screen_width": "1536", "screen_height": "864",
    "browser_language": "zh-CN", "browser_platform": "Win32", "browser_name": "Chrome",
    "browser_version": "146.0.0.0", "browser_online": "true", "engine_name": "Blink",
    "engine_version": "146.0.0.0", "os_name": "Windows", "os_version": "10",
    "cpu_core_num": "16", "device_memory": "8", "platform": "PC", "downlink": "10",
    "effective_type": "4g", "round_trip_time": "200", "uifid": "", "msToken": "",
}

_AWEME_ID_RE = re.compile(r"/(?:video|note|slides)/(\d+)")
_BARE_ID_RE = re.compile(r"^\d{15,25}$")


class DouyinApiError(RuntimeError):
    pass


def extract_aweme_id(value) -> Optional[str]:
    """从作品链接或"作品id"单元格里取出作品 id。取不到返回 None。"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if _BARE_ID_RE.match(text):
        return text
    m = _AWEME_ID_RE.search(text)
    return m.group(1) if m else None


def cookie_header_from_file(path: str) -> str:
    """
    把浏览器扩展导出的 Netscape 格式 cookies.txt 转成一行 "k=v; k=v" 的请求头。

    只取抖音相关域名下的 cookie；顺带也支持那种本身就是一整行 "k=v; k=v" 的文件。
    """
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()

    pairs = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            domain, name, value = parts[0], parts[5], parts[6]
            if "douyin" in domain:
                pairs[name] = value

    if not pairs:
        # 退而求其次：文件本身可能就是一整行 Cookie 头
        flat = " ".join(l for l in raw.splitlines() if not l.strip().startswith("#"))
        if "=" in flat:
            return flat.strip()
        raise DouyinApiError(
            f"{path} 里没找到抖音的 cookie。请确认这份文件是登录抖音后导出的。"
        )

    if "sessionid" not in pairs and "sessionid_ss" not in pairs:
        raise DouyinApiError(
            "cookies 文件里没有登录凭证（sessionid），请先在浏览器里登录抖音再导出。"
        )
    return "; ".join(f"{k}={v}" for k, v in pairs.items())


def sign_url(url: str, params: dict) -> str:
    """给接口 URL 附加 a_bogus 签名，返回可直接请求的完整 URL。"""
    if ABogusManager is None:
        raise DouyinApiError("缺少 f2 库，请运行： pip install f2")
    return str(ABogusManager.model_2_endpoint(UA, url, params))


class DouyinAPI:
    """调抖音网页接口。需要一份登录后的 cookie（"k=v; k=v" 形式的请求头）。"""

    def __init__(self, cookie: str, session=None):
        if not cookie or not cookie.strip():
            raise DouyinApiError("cookie 为空。")
        if session is None:
            if _CurlSession is None:
                raise DouyinApiError("缺少 curl_cffi 库，请运行： pip install curl_cffi")
            session = _CurlSession(timeout=20, impersonate=IMPERSONATE)
        self._session = session
        self._headers = {
            "Accept": "*/*",
            "Referer": "https://www.douyin.com/?recommend=1",
            "User-Agent": UA,
            "Cookie": cookie.strip(),
        }

    def _get_json(self, path: str, extra: dict) -> dict:
        signed = sign_url(f"https://www.douyin.com{path}", {**BASE_PARAMS, **extra})
        resp = self._session.get(signed, headers=self._headers)
        status = getattr(resp, "status_code", 200)
        if status != 200:
            raise DouyinApiError(f"接口返回 HTTP {status}")
        try:
            return resp.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise DouyinApiError(
                "接口没返回有效数据，通常是登录过期，请重新导出一份 cookies.txt。"
            ) from exc

    def aweme_detail(self, aweme_id: str) -> dict:
        data = self._get_json("/aweme/v1/web/aweme/detail/", {"aweme_id": str(aweme_id)})
        detail = data.get("aweme_detail")
        if not detail:
            raise DouyinApiError(f"没查到作品 {aweme_id}（可能已删除或设为私密）")
        return detail

    def fresh_play_url(self, aweme_id: str) -> str:
        """为一条作品现取一个新的播放地址。拿不到就抛 DouyinApiError。"""
        detail = self.aweme_detail(aweme_id)
        play_addr = (detail.get("video") or {}).get("play_addr") or {}
        for url in play_addr.get("url_list") or []:
            if url:
                return url
        uri = play_addr.get("uri")
        if uri:
            return f"https://www.douyin.com/aweme/v1/play/?video_id={uri}&ratio=1080p&line=0"
        raise DouyinApiError(f"作品 {aweme_id} 没有可用的播放地址（可能是图文作品）")


def url_expiry(url: str) -> Optional[int]:
    """读出地址里的 x-expires 到期时间戳（秒）。没有就返回 None。"""
    try:
        query = urlparse(url).query
    except ValueError:
        return None
    m = re.search(r"(?:^|&)x-expires=(\d+)", query)
    return int(m.group(1)) if m else None
