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


# 浏览器指纹必须自洽，否则抖音直接 403。这里有四样东西要对齐：
#   1. 算 a_bogus 签名用的 UA
#   2. 请求里实际发出去的 User-Agent
#   3. curl_cffi 模拟的 TLS/HTTP2 指纹（连带 sec-ch-ua、sec-ch-ua-platform 两个头）
#   4. BASE_PARAMS 里的 os_name / browser_platform / browser_version
CHROME_VERSION = "146"
IMPERSONATE = f"chrome{CHROME_VERSION}"

# curl_cffi 的 chromeNNN 指纹会自己发一个 sec-ch-ua-platform 头，而且**写死是 macOS**
# （在 Linux 上实测也是 macOS，它不跟随本机系统，也改不掉）。所以 UA 和下面的
# os_name / browser_platform 都必须跟着报 macOS，四层才自洽。
#
# 原版报的是 Windows：那份代码跑在 Windows 上恰好不冲突，搬到 Mac 上就变成
# "UA 说 Windows、平台头说 macOS、版本号又对不上"，抖音一看就拦，回 403。
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      f"(KHTML, like Gecko) Chrome/{CHROME_VERSION}.0.0.0 Safari/537.36")
_OS_PARAMS = {"os_name": "Mac OS", "os_version": "10.15.7",
              "browser_platform": "MacIntel"}

BASE_PARAMS = {
    "device_platform": "webapp", "aid": "6383", "channel": "channel_pc_web",
    "update_version_code": "170400", "pc_client_type": "1", "support_h265": "1",
    "support_dash": "1", "version_code": "290100", "version_name": "29.1.0",
    "cookie_enabled": "true", "screen_width": "1536", "screen_height": "864",
    "browser_language": "zh-CN", "browser_name": "Chrome",
    "browser_version": f"{CHROME_VERSION}.0.0.0", "browser_online": "true",
    "engine_name": "Blink", "engine_version": f"{CHROME_VERSION}.0.0.0",
    "cpu_core_num": "16", "device_memory": "8", "platform": "PC", "downlink": "10",
    "effective_type": "4g", "round_trip_time": "200", "uifid": "", "msToken": "",
    **_OS_PARAMS,
}

_AWEME_ID_RE = re.compile(r"/(?:video|note|slides)/(\d+)")
_BARE_ID_RE = re.compile(r"^\d{15,25}$")


class DouyinApiError(RuntimeError):
    pass


class NoVideoError(DouyinApiError):
    """这条作品压根没有视频（图文/图集），没有音频可转写。"""


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

    def __init__(self, cookie: str = "", session=None):
        # cookie 是可选的：免签名那条路本来就不需要登录，只有带签名的备用路线才用得上。
        cookie = (cookie or "").strip()
        self.has_cookie = bool(cookie)
        self.route_used = None
        self.last_response = None
        if session is None:
            if _CurlSession is None:
                raise DouyinApiError("缺少 curl_cffi 库，请运行： pip install curl_cffi")
            session = _CurlSession(timeout=20, impersonate=IMPERSONATE)
        self._session = session
        # msToken / uifid 抖音网页端是从 cookie 里取出来、再当查询参数一起发的。
        # 一直留空等于告诉服务器"我没有这两样"，是风控重点关照的特征，所以
        # cookie 里有就带上。
        jar = {}
        for piece in cookie.split(";"):
            if "=" in piece:
                k, _, v = piece.partition("=")
                jar[k.strip()] = v.strip()
        self._cookie_params = {}
        if jar.get("msToken"):
            self._cookie_params["msToken"] = jar["msToken"]
        for key in ("UIFID", "uifid"):
            if jar.get(key):
                self._cookie_params["uifid"] = jar[key]
                break

        self._headers = {
            "Accept": "*/*",
            "Accept-Encoding": "*/*",
            "Referer": "https://www.douyin.com/?recommend=1",
            # 显式写死，保证"发出去的 UA"和"算签名用的 UA"逐字相同
            "User-Agent": UA,
        }
        if cookie:
            self._headers["Cookie"] = cookie
            if self._cookie_params.get("uifid"):
                # Argus 第一道关卡查的是请求头里的 uifid，不是参数
                self._headers["uifid"] = self._cookie_params["uifid"]

    def _get_json(self, path: str, extra: dict) -> dict:
        params = {**BASE_PARAMS, **self._cookie_params, **extra}
        signed = sign_url(f"https://www.douyin.com{path}", params)
        resp = self._session.get(signed, headers=self._headers)
        self.last_response = resp  # 诊断脚本要拿它看原始回应
        status = getattr(resp, "status_code", 200)
        if status == 403:
            raise DouyinApiError(
                "接口返回 HTTP 403（被抖音风控拦下）。可能是 cookies 过期，"
                "也可能是抖音又改了签名算法。先重新导出一份 cookies.txt 试试；"
                "还不行就是签名需要更新了。"
            )
        if status != 200:
            raise DouyinApiError(f"接口返回 HTTP {status}")
        try:
            return resp.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise DouyinApiError(
                "接口没返回有效数据，通常是登录过期，请重新导出一份 cookies.txt。"
            ) from exc

    def _detail_simple(self, aweme_id: str) -> dict:
        """
        免签名调法：只带 aweme_id 和 aid 两个参数，Referer 报 open.douyin.com，
        不带 Cookie。这条路不经过 Argus 安全网关，所以不需要 a_bogus 之类的签名。

        抖音 2026 年给详情接口加了 ArgusSecurityPlugin 之后，带全套浏览器参数 +
        Cookie + a_bogus 的"正规"调法反而一律 403（Signature Not Found），因为
        网关还要 x-secsdk-web-signature，而开源的签名库都生成不了。参数给少反而能过。
        """
        url = (f"https://www.douyin.com/aweme/v1/web/aweme/detail/"
               f"?aweme_id={aweme_id}&aid=6383")
        headers = {
            "Accept": "application/json, text/plain, */*",
            "User-Agent": UA,
            "Referer": "https://open.douyin.com/",
            "Origin": "https://open.douyin.com",
        }
        resp = self._session.get(url, headers=headers)
        self.last_response = resp
        status = getattr(resp, "status_code", 200)
        if status != 200:
            raise DouyinApiError(f"免签名接口返回 HTTP {status}")
        try:
            return resp.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise DouyinApiError("免签名接口没返回有效 JSON") from exc

    def aweme_detail(self, aweme_id: str) -> dict:
        aweme_id = str(aweme_id)
        routes = [("免签名", self._detail_simple)]
        if self.has_cookie:
            # 带签名这条现在基本被 Argus 挡死，只当备用；没 cookie 就更没必要试
            routes.append(("带签名", lambda i: self._get_json(
                "/aweme/v1/web/aweme/detail/", {"aweme_id": i})))
        attempts = []
        for name, fetch in routes:
            try:
                data = fetch(aweme_id)
            except DouyinApiError as exc:
                attempts.append(f"{name}：{exc}")
                continue
            detail = data.get("aweme_detail")
            if detail:
                self.route_used = name
                return detail
            attempts.append(f"{name}：返回里没有作品数据")
        raise DouyinApiError(
            f"没查到作品 {aweme_id}。两条路都试过了——" + "；".join(attempts)
        )

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
        if detail.get("images"):
            raise NoVideoError(f"作品 {aweme_id} 是图文/图集，没有音频")
        raise DouyinApiError(f"作品 {aweme_id} 没有可用的播放地址")


def url_expiry(url: str) -> Optional[int]:
    """读出地址里的 x-expires 到期时间戳（秒）。没有就返回 None。"""
    try:
        query = urlparse(url).query
    except ValueError:
        return None
    m = re.search(r"(?:^|&)x-expires=(\d+)", query)
    return int(m.group(1)) if m else None
