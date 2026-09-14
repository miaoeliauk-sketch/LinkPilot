# -*- coding: utf-8 -*-
"""抖音扫码登录向导（Mac 适配版）：弹出浏览器 -> 手机抖音扫码 -> 自动保存 Cookie"""
import json, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

# cookie / 浏览器资料目录
_ov = os.environ.get("DY_BASE")
BASE = Path(_ov) if _ov else Path(__file__).parent
PROFILE = BASE / "browser_profile"
OUT_JSON = BASE / "cookie.json"
OUT_TXT = BASE / "cookie.txt"

WAIT_SECONDS = 900  # 最多等 15 分钟


def launch(p):
    """Mac 上优先用系统已装的 Chrome；没有就退回 Playwright 自带的 Chromium。"""
    common = dict(user_data_dir=str(PROFILE), headless=False,
                  args=["--start-maximized"], no_viewport=True)
    for channel in ("chrome", "msedge", None):
        try:
            if channel:
                return p.chromium.launch_persistent_context(channel=channel, **common)
            return p.chromium.launch_persistent_context(**common)
        except Exception as e:
            print(f"（{channel or 'chromium'} 启动失败，换一个试试：{e}）", flush=True)
    raise RuntimeError(
        "没有可用的浏览器。请先装 Google Chrome，或运行：python3 -m playwright install chromium"
    )


def main():
    with sync_playwright() as p:
        ctx = launch(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.douyin.com/", wait_until="domcontentloaded")

        print("已打开抖音页面，请在浏览器里完成登录（推荐扫码）...", flush=True)
        deadline = time.time() + WAIT_SECONDS
        logged = False
        while time.time() < deadline:
            cookies = ctx.cookies("https://www.douyin.com")
            names = {c["name"] for c in cookies}
            if "sessionid_ss" in names or "sessionid" in names:
                logged = True
                break
            time.sleep(3)

        if not logged:
            print(f"TIMEOUT: {WAIT_SECONDS // 60} 分钟内未检测到登录", flush=True)
            ctx.close()
            sys.exit(2)

        cookies = ctx.cookies("https://www.douyin.com")
        OUT_JSON.write_text(json.dumps(cookies, ensure_ascii=False, indent=1), encoding="utf-8")
        cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in cookies)
        OUT_TXT.write_text(cookie_str, encoding="utf-8")
        print(f"LOGIN_OK: 检测到登录，已保存 {len(cookies)} 条 Cookie -> {OUT_TXT.name}", flush=True)
        ctx.close()


if __name__ == "__main__":
    main()
