# -*- coding: utf-8 -*-
"""扒抖音作品 - 桌面窗口版（Mac 适配版）"""
import os
import re
import subprocess
import sys
import threading
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import font as tkfont
from tkinter import messagebox, ttk

APP_DIR = Path(__file__).parent          # 程序文件目录（dy_export / signer 都在这）
BASE = APP_DIR
sys.path.insert(0, str(APP_DIR))

from openpyxl import Workbook

from dy_export import (
    ILLEGAL_CHARS, HEADERS_50, DouyinClient, OUT_DIR, load_cookie,
    resolve_link, row_from_aweme,
)

C_BG = "#f5f6f8"
C_CARD = "#ffffff"
C_LINE = "#e5e6eb"
C_TEXT = "#1f2329"
C_SUB = "#86909c"
C_BLUE = "#2b7fff"
C_BLUE_D = "#1d63d6"
C_LOG_BG = "#0f1115"
C_LOG_FG = "#c9d1d9"

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform.startswith("win")

FONT_UI = "PingFang SC" if IS_MAC else "Microsoft YaHei"
FONT_MONO = "Menlo" if IS_MAC else "Consolas"


def open_path(path):
    """跨平台「用系统默认程序打开文件/文件夹」。Windows 的 os.startfile 在 Mac 上不存在。"""
    path = str(path)
    if IS_MAC:
        subprocess.Popen(["open", path])
    elif IS_WIN:
        os.startfile(path)  # noqa: B606
    else:
        subprocess.Popen(["xdg-open", path])


STATE = {"running": False, "count": 0, "author": "", "phase": "等待开始",
         "logs": [], "done": False, "file": "", "error": ""}


def log(msg: str):
    STATE["logs"].append(f"[{datetime.now():%H:%M:%S}] {msg}")
    if len(STATE["logs"]) > 500:
        STATE["logs"] = STATE["logs"][-500:]


def scrape_worker(link: str):
    try:
        STATE.update(running=True, count=0, done=False, file="", error="", logs=[])
        log("正在识别链接…")
        target = resolve_link(link)
        client = DouyinClient(load_cookie())
        if "aweme_id" in target:
            log("单作品链接，正在查询作者…")
            aweme = client.aweme_detail(target["aweme_id"])
            target = {"sec_user_id": (aweme.get("author") or {}).get("sec_uid")}
        log("正在获取作者信息…")
        profile = client.user_profile(target["sec_user_id"])
        info = {"nickname": profile.get("nickname") or "未知作者",
                "sec_uid": profile.get("sec_uid", target["sec_user_id"]),
                "uid": profile.get("uid", ""),
                "follower_count": profile.get("follower_count") or 0}
        STATE["author"] = info["nickname"]
        log(f"作者：{info['nickname']}（粉丝 {info['follower_count']}）")

        rows = []
        _mp = int(os.environ.get("DY_MAX_PAGES", "0")) or 200
        for batch in client.user_posts(target["sec_user_id"], max_pages=_mp):
            for aweme in batch:
                rows.append([ILLEGAL_CHARS.sub("", v) if isinstance(v, str) else v
                             for v in row_from_aweme(len(rows) + 1, aweme, info)])
            STATE["count"] = len(rows)
            log(f"已抓取 {len(rows)} 条作品…")

        if not rows:
            raise RuntimeError("一条作品都没抓到：多半是登录过期，请点「重新扫码登录」")

        OUT_DIR.mkdir(exist_ok=True)
        safe = re.sub(r'[\\/:*?"<>|]', "_", info["nickname"]) or "作者"
        out = OUT_DIR / f"作品列表_{safe}_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
        wb = Workbook()
        ws = wb.active
        ws.title = "作品列表"
        ws.append(HEADERS_50)
        for r in rows:
            ws.append(r)
        wb.save(out)
        STATE["file"] = str(out)
        STATE["phase"] = "已完成"
        log(f"导出成功：{out.name}")
    except Exception as e:
        STATE["error"] = str(e)
        STATE["phase"] = "失败"
        log(f"出错：{e}")
    finally:
        STATE["running"] = False
        STATE["done"] = True


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("扒抖音作品")
        root.geometry("1060x790")
        root.minsize(980, 740)
        root.configure(bg=C_BG)
        # Mac 屏幕上字号偏小，整体 +2
        bump = 2 if IS_MAC else 0
        self.f_title = tkfont.Font(family=FONT_UI, size=13 + bump, weight="bold")
        self.f_norm = tkfont.Font(family=FONT_UI, size=10 + bump)
        self.f_sub = tkfont.Font(family=FONT_UI, size=9 + bump)
        self.f_mono = tkfont.Font(family=FONT_MONO, size=9 + bump)
        self.build()
        self.poll()

    def card(self, parent, title):
        outer = tk.Frame(parent, bg=C_CARD, highlightbackground=C_LINE, highlightthickness=1)
        if title:
            tk.Label(outer, text=title, bg=C_CARD, fg="#4e5969", font=self.f_norm).pack(anchor="w", padx=16, pady=(14, 6))
        return outer

    def button(self, parent, text, cmd, primary=False, width=None):
        # Mac 原生 tk.Button 不认 bg/fg，用 highlightbackground 才能上色
        b = tk.Button(parent, text=text, command=cmd,
                      bg=C_BLUE if primary else "#f2f3f5",
                      fg="#ffffff" if primary else C_TEXT,
                      activebackground=C_BLUE_D if primary else "#e8eaed",
                      activeforeground="#ffffff" if primary else C_TEXT,
                      relief="flat", bd=0, font=self.f_norm, padx=18, pady=8,
                      cursor="hand2" if not IS_MAC else "pointinghand", width=width,
                      highlightbackground=C_CARD)
        return b

    def build(self):
        head = tk.Frame(self.root, bg=C_CARD, highlightbackground=C_LINE, highlightthickness=1)
        head.pack(fill="x")
        logo = tk.Label(head, text="扒", bg=C_BLUE, fg="#fff", font=self.f_title, width=3, height=1)
        logo.pack(side="left", padx=(18, 12), pady=14)
        tk.Label(head, text="扒抖音作品", bg=C_CARD, fg=C_TEXT, font=self.f_title).pack(side="left", pady=(18, 2))
        tk.Label(head, text="粘贴链接 → 自动抓取全部作品 → 导出 50 列 Excel", bg=C_CARD, fg=C_SUB,
                 font=self.f_sub).pack(side="left", padx=12, pady=(22, 0))

        body = tk.Frame(self.root, bg=C_BG)
        body.pack(fill="both", expand=True, padx=18, pady=16)
        left = tk.Frame(body, bg=C_BG)
        left.pack(side="left", fill="both", expand=True)
        right = tk.Frame(body, bg=C_BG, width=300)
        right.pack(side="right", fill="y", padx=(16, 0))
        right.pack_propagate(False)

        c1 = self.card(left, "① 粘贴链接")
        c1.pack(fill="x")
        self.txt = tk.Text(c1, height=3, font=self.f_norm, relief="flat", bg="#fafbfc",
                           highlightbackground=C_LINE, highlightthickness=1, wrap="word")
        self.txt.pack(fill="x", padx=16, pady=(0, 4))
        self.hint = tk.Label(c1, text="支持：博主主页链接 / v.douyin.com 分享短链 / App 里复制的整段分享文案",
                             bg=C_CARD, fg="#a8b0bd", font=self.f_sub)
        self.hint.pack(anchor="w", padx=16)
        row = tk.Frame(c1, bg=C_CARD)
        row.pack(fill="x", padx=16, pady=12)
        self.btn_start = self.button(row, "开始扒取", self.start, primary=True)
        self.btn_start.pack(side="left")
        self.button(row, "重新扫码登录", self.relogin).pack(side="left", padx=10)
        self.button(row, "打开输出文件夹", self.open_folder).pack(side="left")

        self.result = tk.Frame(left, bg="#f2f8ff", highlightbackground="#c9e0ff", highlightthickness=1)
        c2 = self.card(left, "② 进度")
        c2.pack(fill="both", expand=True, pady=(14, 0))
        self.pb = ttk.Progressbar(c2, mode="determinate", maximum=100)
        self.pb.pack(fill="x", padx=16, pady=(0, 6))
        st = tk.Frame(c2, bg=C_CARD)
        st.pack(fill="x", padx=16)
        self.lbl_phase = tk.Label(st, text="等待开始", bg=C_CARD, fg=C_SUB, font=self.f_sub)
        self.lbl_phase.pack(side="left")
        self.lbl_count = tk.Label(st, text="", bg=C_CARD, fg=C_SUB, font=self.f_sub)
        self.lbl_count.pack(side="right")
        self.logbox = tk.Text(c2, bg=C_LOG_BG, fg=C_LOG_FG, font=self.f_mono, relief="flat",
                              wrap="word", padx=10, pady=8, state="disabled", height=9)
        self.logbox.pack(fill="both", expand=True, padx=16, pady=(8, 14))

        inner = tk.Frame(self.result, bg="#f2f8ff")
        inner.pack(fill="x", padx=14, pady=12)
        self.lbl_res = tk.Label(inner, text="", bg="#f2f8ff", fg=C_TEXT, font=self.f_norm)
        self.lbl_res.pack(anchor="w")
        self.lbl_path = tk.Label(inner, text="", bg="#f2f8ff", fg="#4e5969", font=self.f_sub, wraplength=620, justify="left")
        self.lbl_path.pack(anchor="w", pady=(6, 10))
        rr = tk.Frame(inner, bg="#f2f8ff")
        rr.pack(anchor="w")
        self.button(rr, "打开 Excel", self.open_file, primary=True).pack(side="left")
        self.button(rr, "打开所在文件夹", self.open_folder).pack(side="left", padx=10)

        c3 = self.card(right, "最近导出")
        c3.pack(fill="x")
        self.hist = tk.Frame(c3, bg=C_CARD)
        self.hist.pack(fill="x", padx=16, pady=(0, 14))

        c4 = self.card(right, "使用说明")
        c4.pack(fill="both", expand=True, pady=(14, 0))
        tk.Label(c4, text=("1. 抖音 App → 博主主页 → 分享 → 复制链接\n"
                           "2. 首次使用先点「重新扫码登录」，用手机抖音扫码\n"
                           "3. 抓取速度约 20 条/秒，1400 条约 2~3 分钟\n"
                           "4. 导出的 Excel 是 50 列标准格式，\n    可直接喂给逐字稿转写工具\n"
                           "5. 点赞数是实时的，与上次导出略有差别属正常"),
                 bg=C_CARD, fg=C_SUB, font=self.f_sub, justify="left").pack(anchor="w", padx=16, pady=(0, 16))
        self.load_hist()

    def start(self):
        link = self.txt.get("1.0", "end").strip()
        if not link:
            messagebox.showinfo("提示", "请先粘贴链接")
            return
        if STATE["running"]:
            messagebox.showinfo("提示", "正在抓取中，请稍候")
            return
        self.btn_start.config(state="disabled", bg="#9dc4ff")
        self.result.pack_forget()
        self.pb["value"] = 0
        threading.Thread(target=scrape_worker, args=(link,), daemon=True).start()

    def poll(self):
        if STATE["logs"]:
            txt = "\n".join(STATE["logs"])
            if self.logbox.get("1.0", "end").strip() != txt.strip():
                self.logbox.config(state="normal")
                self.logbox.delete("1.0", "end")
                self.logbox.insert("1.0", txt)
                self.logbox.see("end")
                self.logbox.config(state="disabled")
        self.lbl_phase.config(text=STATE["phase"])
        self.lbl_count.config(text=f"已抓取 {STATE['count']} 条" if STATE["count"] else "")
        self.pb["value"] = 100 if STATE["done"] else min(96, STATE["count"] / 15)
        if STATE["done"]:
            self.btn_start.config(state="normal", bg=C_BLUE)
            if STATE["file"]:
                self.lbl_res.config(text=f"作者：{STATE['author']}    条数：{STATE['count']} 条")
                self.lbl_path.config(text=STATE["file"])
                self.result.pack(side="bottom", fill="x", pady=(14, 0))
                self.load_hist()
            elif STATE["error"]:
                messagebox.showerror("失败", STATE["error"])
            STATE["done"] = False
        self.root.after(600, self.poll)

    def load_hist(self):
        for w in self.hist.winfo_children():
            w.destroy()
        if not OUT_DIR.exists():
            return
        files = sorted(OUT_DIR.glob("*.xlsx"), key=lambda f: f.stat().st_mtime, reverse=True)[:7]
        for f in files:
            name = f.name if len(f.name) <= 26 else f.name[:24] + "…"
            lb = tk.Label(self.hist, text=f"{name}   {datetime.fromtimestamp(f.stat().st_mtime):%m-%d %H:%M}",
                          bg=C_CARD, fg="#4e5969", font=self.f_sub, anchor="w",
                          cursor="pointinghand" if IS_MAC else "hand2")
            lb.pack(fill="x", pady=3)
            lb.bind("<Button-1>", lambda e, p=str(f): open_path(p))
            lb.bind("<Enter>", lambda e, w=lb: w.config(fg=C_BLUE))
            lb.bind("<Leave>", lambda e, w=lb: w.config(fg="#4e5969"))

    def open_file(self):
        if STATE["file"] and os.path.exists(STATE["file"]):
            open_path(STATE["file"])

    def open_folder(self):
        OUT_DIR.mkdir(exist_ok=True)
        open_path(OUT_DIR)

    def relogin(self):
        # 用「正在运行本程序的这个 Python」去调登录向导，避免写死环境路径
        subprocess.Popen([sys.executable, str(APP_DIR / "dy_login.py")])
        messagebox.showinfo("提示", "已打开登录窗口，请用手机抖音扫码登录")


if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    _auto = os.environ.get("DY_GUI_AUTOSTART")
    if _auto:
        def _kick():
            app.txt.insert("1.0", _auto)
            app.start()
        root.after(1200, _kick)
    root.mainloop()
