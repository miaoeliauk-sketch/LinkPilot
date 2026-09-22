#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抖音逐字稿提取工具 —— 图形界面版

给不习惯用命令行的用户用：打开一个窗口，把链接粘贴进去，点"开始转写"，
等一会儿就能在窗口里直接看到转写文字，同时也会照常生成 txt 文件和汇总 Excel。

使用前提：
    和命令行版（douyin_batch_transcript.py）用同一套依赖，运行前请确认已经执行过：
        pip install -r requirements.txt
    并且系统装好了 ffmpeg。

运行方式：
    python3 douyin_transcript_gui.py

本文件直接复用 douyin_batch_transcript.py 里的下载、转写、Excel 汇总等逻辑，
两个文件需要放在同一个目录下。
"""

import os
import queue
import sys
import threading
import time
import tkinter as tk
from urllib.parse import urlparse
from datetime import datetime
from tkinter import filedialog, messagebox, scrolledtext, ttk
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import douyin_batch_transcript as core
except ImportError as exc:
    raise RuntimeError(
        "找不到 douyin_batch_transcript.py，请确认它和本文件在同一个文件夹里。"
    ) from exc

try:
    import douyin_excel_transcript as excel_core
except ImportError as exc:
    raise RuntimeError(
        "找不到 douyin_excel_transcript.py，请确认它和本文件在同一个文件夹里。"
    ) from exc

BUILD = "2026-09-22l"


class PlaceholderUrlError(RuntimeError):
    """这一行在表格里存的是多行共用的占位地址，不是真实视频，处理也是白处理。"""

try:
    import douyin_api
except ImportError as exc:
    raise RuntimeError(
        "找不到 douyin_api.py，请确认它和本文件在同一个文件夹里。"
    ) from exc

try:
    import openpyxl
except ImportError:
    openpyxl = None


class TranscriptGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("抖音视频逐字稿提取工具")
        self.root.geometry("900x720")

        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.result_queue: "queue.Queue[str]" = queue.Queue()
        self.done_queue: "queue.Queue[bool]" = queue.Queue()
        self.is_running = False
        self.stop_requested = threading.Event()

        self._build_widgets()
        self.root.after(200, self._poll_log_queue)

    def _build_widgets(self):
        pad = {"padx": 10, "pady": 6}

        tk.Label(
            self.root,
            text="抖音视频链接（可以直接粘贴 App 分享出来的整段文案，程序会自动挑出链接；"
                 "也支持直接粘贴 .mp4/.m3u8 这种视频文件地址）：",
        ).pack(anchor="w", **pad)
        self.links_text = scrolledtext.ScrolledText(self.root, height=6, wrap="word")
        self.links_text.pack(fill="x", **pad)

        excel_frame = tk.Frame(self.root)
        excel_frame.pack(fill="x", **pad)
        tk.Label(excel_frame, text="—— 或者：直接选一份或多份 Excel 表格（比如批量采集工具导出的作品列表）——", fg="#555").pack(
            anchor="w"
        )
        excel_row = tk.Frame(excel_frame)
        excel_row.pack(fill="x", pady=(4, 0))
        tk.Button(excel_row, text="选择 Excel 文件...（可多选）", command=self._choose_excel_file).pack(side="left")
        self.excel_paths = []
        self.excel_path_var = tk.StringVar(value="")
        tk.Label(excel_row, textvariable=self.excel_path_var, fg="#2e7d32").pack(side="left", padx=(10, 10))
        tk.Button(excel_row, text="清除，改回手动粘贴链接", command=self._clear_excel_file).pack(side="left")
        tk.Label(
            excel_frame,
            text="选好 Excel 后会忽略上面的链接框，自动按\"作品网址\"列取链接，转写结果直接写回这份表格；\n"
                 "可以一次选多个文件，程序会依次处理完一个再处理下一个。",
            fg="#888",
            justify="left",
        ).pack(anchor="w", pady=(2, 0))

        top_options_frame = tk.Frame(self.root)
        top_options_frame.pack(fill="x", **pad)

        tk.Label(top_options_frame, text="转写模式：").grid(row=0, column=0, sticky="w")
        self.mode_var = tk.StringVar(value="local")
        mode_combo = ttk.Combobox(
            top_options_frame, textvariable=self.mode_var, values=["local", "api", "bailian"],
            width=10, state="readonly",
        )
        mode_combo.grid(row=0, column=1, sticky="w", padx=(0, 20))
        mode_combo.bind("<<ComboboxSelected>>", lambda _evt: self._on_mode_changed())

        tk.Label(top_options_frame, text="浏览器 Cookies：").grid(row=0, column=2, sticky="w")
        self.cookies_var = tk.StringVar(value="chrome")
        ttk.Combobox(
            top_options_frame, textvariable=self.cookies_var,
            values=["无", "chrome", "safari", "firefox", "edge"],
            width=10, state="readonly",
        ).grid(row=0, column=3, sticky="w", padx=(0, 20))

        cookies_file_frame = tk.Frame(self.root)
        cookies_file_frame.pack(fill="x", **pad)
        tk.Label(
            cookies_file_frame,
            text="Cookies 文件（可选，填了就优先用这个，不用上面自动读浏览器的方式）：",
        ).pack(anchor="w")
        cookies_file_row = tk.Frame(cookies_file_frame)
        cookies_file_row.pack(fill="x", pady=(2, 0))
        self.cookies_file_var = tk.StringVar(value="")
        tk.Entry(cookies_file_row, textvariable=self.cookies_file_var, width=60).pack(
            side="left", padx=(0, 4)
        )
        tk.Button(cookies_file_row, text="选择...", command=self._choose_cookies_file).pack(side="left")
        tk.Button(cookies_file_row, text="清除", command=lambda: self.cookies_file_var.set("")).pack(
            side="left", padx=(4, 0)
        )
        tk.Label(
            cookies_file_frame,
            text="自动读浏览器 Cookies 在部分电脑上会因为权限/加密问题读不到，如果一直报\n"
                 "\"Fresh cookies... are needed\"，可以装个浏览器扩展（比如 Get cookies.txt LOCALLY）\n"
                 "登录抖音后导出一份 cookies.txt，这里选中它就行。",
            fg="#888",
            justify="left",
        ).pack(anchor="w", pady=(2, 0))

        # 装转写模式专属选项的固定容器：位置一直不变，切换模式时只换里面的内容，
        # 不会因为 pack_forget/pack 的先后顺序导致整个界面跳来跳去
        self.dynamic_options_frame = tk.Frame(self.root)
        self.dynamic_options_frame.pack(fill="x", **pad)

        # local 模式的选项
        self.local_frame = tk.Frame(self.dynamic_options_frame)
        tk.Label(self.local_frame, text="本地模型大小：").grid(row=0, column=0, sticky="w")
        self.model_var = tk.StringVar(value="small")
        ttk.Combobox(
            self.local_frame, textvariable=self.model_var,
            values=["tiny", "base", "small", "medium", "large"],
            width=10, state="readonly",
        ).grid(row=0, column=1, sticky="w")

        # api 模式的选项（OpenAI 官方 / SiliconFlow 等第三方）
        self.api_frame = tk.Frame(self.dynamic_options_frame)
        tk.Label(self.api_frame, text="API Key：").grid(row=0, column=0, sticky="w")
        self.api_key_var = tk.StringVar(value=os.environ.get("OPENAI_API_KEY", ""))
        tk.Entry(self.api_frame, textvariable=self.api_key_var, width=24, show="*").grid(
            row=0, column=1, sticky="w", padx=(0, 20)
        )
        tk.Label(self.api_frame, text="模型名：").grid(row=0, column=2, sticky="w")
        self.api_model_var = tk.StringVar(value="whisper-1")
        tk.Entry(self.api_frame, textvariable=self.api_model_var, width=20).grid(row=0, column=3, sticky="w")

        tk.Label(self.api_frame, text="接口地址（留空=OpenAI 官方，填 SiliconFlow 等第三方的地址）：").grid(
            row=1, column=0, columnspan=2, sticky="w", pady=(4, 0)
        )
        self.api_base_url_var = tk.StringVar(value="")
        tk.Entry(self.api_frame, textvariable=self.api_base_url_var, width=40).grid(
            row=1, column=2, columnspan=2, sticky="w", pady=(4, 0)
        )

        # bailian 模式的选项（阿里云百炼/DashScope）
        self.bailian_frame = tk.Frame(self.dynamic_options_frame)
        tk.Label(self.bailian_frame, text="DashScope Key：").grid(row=0, column=0, sticky="w")
        self.dashscope_api_key_var = tk.StringVar(value=os.environ.get("DASHSCOPE_API_KEY", ""))
        tk.Entry(self.bailian_frame, textvariable=self.dashscope_api_key_var, width=24, show="*").grid(
            row=0, column=1, sticky="w"
        )

        self._on_mode_changed()

        output_frame = tk.Frame(self.root)
        output_frame.pack(fill="x", **pad)
        tk.Label(output_frame, text="输出目录：").pack(side="left")
        self.output_dir_var = tk.StringVar(
            value=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
        )
        tk.Entry(output_frame, textvariable=self.output_dir_var, width=60).pack(
            side="left", padx=(4, 4)
        )
        tk.Button(output_frame, text="选择...", command=self._choose_output_dir).pack(side="left")

        keep_video_frame = tk.Frame(self.root)
        keep_video_frame.pack(fill="x", **pad)
        self.keep_video_var = tk.BooleanVar(value=False)
        tk.Checkbutton(
            keep_video_frame, text="同时保留视频文件（不只提取文字，也把原视频存下来）",
            variable=self.keep_video_var, onvalue=True, offvalue=False,
        ).pack(anchor="w")

        button_frame = tk.Frame(self.root)
        button_frame.pack(fill="x", **pad)
        self.start_button = tk.Button(
            button_frame, text="开始转写", command=self._on_start_clicked,
            bg="#2e7d32", fg="white", width=16, height=2,
        )
        self.start_button.pack(side="left")
        self.stop_button = tk.Button(
            button_frame, text="停止", command=self._on_stop_clicked,
            bg="#c62828", fg="white", width=10, height=2, state="disabled",
        )
        self.stop_button.pack(side="left", padx=(10, 0))
        tk.Button(button_frame, text="打开输出文件夹", command=self._open_output_dir).pack(
            side="left", padx=(10, 0)
        )

        tk.Label(self.root, text="运行日志：").pack(anchor="w", **pad)
        self.log_text = scrolledtext.ScrolledText(self.root, height=8, state="disabled", wrap="word")
        self.log_text.pack(fill="x", **pad)

        tk.Label(self.root, text="转写结果：").pack(anchor="w", **pad)
        self.result_text = scrolledtext.ScrolledText(self.root, height=10, wrap="word")
        self.result_text.pack(fill="both", expand=True, **pad)

    def _choose_output_dir(self):
        chosen = filedialog.askdirectory()
        if chosen:
            self.output_dir_var.set(chosen)

    def _choose_cookies_file(self):
        chosen = filedialog.askopenfilename(
            title="选择 cookies.txt 文件",
            filetypes=[("文本文件", "*.txt"), ("所有文件", "*.*")],
        )
        if chosen:
            self.cookies_file_var.set(chosen)

    def _on_stop_clicked(self):
        if not self.is_running:
            return
        self.stop_requested.set()
        self.stop_button.configure(state="disabled", text="停止中...")
        self._log("收到停止请求，等当前这一条处理完就会停下来（已经处理完的部分不会丢）。")

    def _open_output_dir(self):
        output_dir = self.output_dir_var.get().strip()
        if not output_dir or not os.path.isdir(output_dir):
            messagebox.showinfo("提示", "输出目录还不存在，请先运行一次转写。")
            return
        if sys.platform == "darwin":
            os.system(f'open "{output_dir}"')
        elif sys.platform.startswith("win"):
            os.startfile(output_dir)  # noqa: S606
        else:
            os.system(f'xdg-open "{output_dir}"')

    def _on_mode_changed(self):
        """只显示当前转写模式用得到的选项，其它模式的输入框直接隐藏，界面别那么乱。
        三个选项 Frame 都是 dynamic_options_frame 的子控件，dynamic_options_frame
        本身在 root 里的位置固定不变，所以切换只影响它内部的内容，不会打乱整体布局。
        """
        mode = self.mode_var.get()
        for frame in (self.local_frame, self.api_frame, self.bailian_frame):
            frame.pack_forget()
        target = {"local": self.local_frame, "api": self.api_frame, "bailian": self.bailian_frame}.get(mode)
        if target is not None:
            target.pack(fill="x", anchor="w")

    def _choose_excel_file(self):
        if openpyxl is None:
            messagebox.showerror("错误", "未安装 openpyxl，请先运行: pip install openpyxl")
            return
        chosen = filedialog.askopenfilenames(
            title="选择 Excel 表格（可以按住 Cmd/Ctrl 多选）",
            filetypes=[("Excel 文件", "*.xlsx"), ("所有文件", "*.*")],
        )
        if chosen:
            self.excel_paths = list(chosen)
            if len(self.excel_paths) == 1:
                self.excel_path_var.set(self.excel_paths[0])
            else:
                names = "、".join(os.path.basename(p) for p in self.excel_paths)
                self.excel_path_var.set(f"已选择 {len(self.excel_paths)} 个文件：{names}")

    def _clear_excel_file(self):
        self.excel_paths = []
        self.excel_path_var.set("")

    def _log(self, message: str):
        self.log_queue.put(message)
        # 同时打到终端：出问题时用户截的往往是终端窗口，日志只留在界面里就等于看不见
        print(message, flush=True)

    def _clear_result_display(self):
        """开始新一轮转写前清空结果框，同时把队列里可能残留的上一轮内容也清掉。"""
        self.result_text.delete("1.0", "end")
        try:
            while True:
                self.result_queue.get_nowait()
        except queue.Empty:
            pass

    def _log_result(self, text: str):
        """从后台线程往转写结果框写内容：Tk 控件只能在主线程操作，这里统一走队列，
        由 _poll_log_queue（在主线程的 after() 定时器里跑）来真正调用 insert。"""
        self.result_queue.put(text)

    def _poll_log_queue(self):
        try:
            while True:
                message = self.log_queue.get_nowait()
                self.log_text.configure(state="normal")
                self.log_text.insert("end", message + "\n")
                self.log_text.see("end")
                self.log_text.configure(state="disabled")
        except queue.Empty:
            pass
        try:
            while True:
                text = self.result_queue.get_nowait()
                self.result_text.insert("end", text)
                self.result_text.see("end")
        except queue.Empty:
            pass
        try:
            while True:
                self.done_queue.get_nowait()
                self.start_button.configure(state="normal", text="开始转写")
                self.stop_button.configure(state="disabled", text="停止")
        except queue.Empty:
            pass
        self.root.after(200, self._poll_log_queue)

    def _on_start_clicked(self):
        if self.is_running:
            messagebox.showinfo("提示", "正在处理中，请等它跑完再开始下一批。")
            return

        if not core.is_opencc_available():
            self._log(
                "提示：未安装 opencc-python-reimplemented，本次转写结果可能出现繁体字。"
                "运行 pip3 install opencc-python-reimplemented 装好后重新跑就会自动转成简体。"
            )

        mode = self.mode_var.get()

        transcribe_args = SimpleNamespace(
            model_size=self.model_var.get(),
            api_key=self.api_key_var.get().strip(),
            api_base_url=self.api_base_url_var.get().strip(),
            api_model=self.api_model_var.get().strip() or "whisper-1",
            dashscope_api_key=self.dashscope_api_key_var.get().strip(),
        )

        if mode == "api" and not transcribe_args.api_key:
            messagebox.showwarning("提示", "api 模式下必须填写 API Key。")
            return
        if mode == "bailian" and not transcribe_args.dashscope_api_key:
            messagebox.showwarning("提示", "bailian 模式下必须填写 DashScope Key。")
            return

        cookies_from_browser = self.cookies_var.get()
        if cookies_from_browser == "无":
            cookies_from_browser = ""
        # 填了 cookies 文件的话优先用这个，不再同时让 yt-dlp 去自动读浏览器（避免两边冲突）
        if self.cookies_file_var.get().strip():
            cookies_from_browser = ""

        if self.excel_paths:
            missing = [p for p in self.excel_paths if not os.path.isfile(p)]
            if missing:
                messagebox.showerror("错误", "找不到以下 Excel 文件：\n" + "\n".join(missing))
                return
            output_dir = self.output_dir_var.get().strip()
            try:
                os.makedirs(output_dir, exist_ok=True)
            except OSError as exc:
                messagebox.showerror("错误", f"无法创建输出目录：{exc}")
                return
            self._clear_result_display()
            self.stop_requested.clear()
            self.is_running = True
            self.start_button.configure(state="disabled", text="处理中...")
            self.stop_button.configure(state="normal", text="停止")
            worker = threading.Thread(
                target=self._run_excel_worker,
                args=(self.excel_paths, mode, transcribe_args, cookies_from_browser, output_dir),
                daemon=True,
            )
            worker.start()
            return

        raw_links = self.links_text.get("1.0", "end").strip()
        links = core.extract_douyin_links(raw_links)
        if not links:
            messagebox.showwarning(
                "提示",
                "没有识别到抖音链接（或者直接的视频文件地址），也没有选 Excel 文件。可以直接粘贴\n"
                "App 分享出来的整段文案（标题、话题标签都没关系），程序会自动从里面挑出链接；\n"
                "或者点上面\"选择 Excel 文件\"。",
            )
            return

        output_dir = self.output_dir_var.get().strip()
        try:
            os.makedirs(output_dir, exist_ok=True)
        except OSError as exc:
            messagebox.showerror("错误", f"无法创建输出目录：{exc}")
            return

        self._clear_result_display()
        self.stop_requested.clear()
        self.is_running = True
        self.start_button.configure(state="disabled", text="处理中...")
        self.stop_button.configure(state="normal", text="停止")

        worker = threading.Thread(
            target=self._run_worker,
            args=(links, mode, transcribe_args, output_dir, cookies_from_browser),
            daemon=True,
        )
        worker.start()

    def _run_excel_worker(self, excel_paths, mode, transcribe_args, cookies_from_browser, output_dir):
        """外层安全网：不管里面出什么没预料到的异常，都保证按钮状态能恢复，
        不会再出现"卡在处理中"却没有任何后续反应的情况。这里统一负责多个 Excel
        文件之间的调度，每个文件的具体处理交给 _process_one_excel_file。"""
        try:
            total_files = len(excel_paths)
            for file_idx, excel_path in enumerate(excel_paths, start=1):
                if self.stop_requested.is_set():
                    self._log("已停止，还没处理的 Excel 文件不会再继续处理。")
                    break
                if total_files > 1:
                    self._log(f"===== 开始处理第 {file_idx}/{total_files} 个文件：{os.path.basename(excel_path)} =====")
                self._process_one_excel_file(excel_path, mode, transcribe_args, cookies_from_browser, output_dir)
        except Exception as exc:  # noqa: BLE001
            self._log(f"处理过程中发生未预料到的错误，已经停止：{exc}")
        finally:
            self.is_running = False
            self.done_queue.put(True)

    def _make_douyin_api(self):
        """
        用"Cookies 文件"里的登录信息建一个抖音接口客户端，用来在下载前现取新地址。

        建不起来不算错误——会退回用表格里存的地址，只是那些地址过期后就下不动了。
        """
        # cookies 是可选的：现取地址走的是抖音的免签名接口，不需要登录。
        # 填了的话会多一条带签名的备用路线，仅此而已。
        cookie = ""
        cookies_file = self.cookies_file_var.get().strip()
        if cookies_file:
            try:
                cookie = douyin_api.cookie_header_from_file(cookies_file)
            except Exception as exc:  # noqa: BLE001
                self._log(f"Cookies 文件读不了（{exc}），不影响，继续用免登录方式。")
        try:
            api = douyin_api.DouyinAPI(cookie)
        except douyin_api.DouyinApiError as exc:
            self._log(f"初始化抖音接口失败：{exc}\n    先退回用表格里存的地址。")
            return None
        self._log("已启用\"下载前现取地址\"，不再依赖表格里那些会过期的地址。")
        return api

    def _process_one_excel_file(self, excel_path, mode, transcribe_args, cookies_from_browser, output_dir):
        """处理单个 Excel 文件，不负责整体的 is_running/按钮状态（那些由
        _run_excel_worker 统一管理），方便多文件依次处理时正确衔接。"""
        tmp_dir = os.path.join(os.path.dirname(os.path.abspath(excel_path)) or ".", "_audio_tmp")
        try:
            os.makedirs(tmp_dir, exist_ok=True)
        except OSError as exc:
            self._log(f"无法创建临时音频目录：{exc}")
            return

        try:
            wb = openpyxl.load_workbook(excel_path)
        except Exception as exc:  # noqa: BLE001
            self._log(f"打开 Excel 文件失败：{exc}")
            return

        ws = wb.worksheets[0]
        header = [cell.value for cell in ws[1]]

        link_col = excel_core.find_column_index(header, "作品网址")
        if link_col is None:
            self._log(f"表格里找不到\"作品网址\"列，实际的列名有：{header}")
            return

        # 表格里那列"视频源网址"是带签名的临时地址，隔夜就失效（403），所以它只当备用。
        # 首选是拿"作品id"在下载前现去抖音要一个新地址，见下面的 api。
        media_col = excel_core.find_column_index(header, "视频源网址")
        id_col = excel_core.find_column_index(header, "作品id")
        type_col = excel_core.find_column_index(header, "作品类型")

        api = self._make_douyin_api()

        # 采集工具抓不到真实地址时，会给很多行填同一个占位地址（实测一份表里 132/330
        # 行共用一个）。这种地址下下来是同一段静音内容，转写出来全是幻觉垃圾。
        # 先把"被多行共用"的地址找出来，后面直接跳过，别浪费几小时。
        # 同一个文件在不同域名下地址不一样（sf3-sign/... 和 sf11-cdn-tos/obj/...），
        # 所以按地址末尾那个对象 id 来认，才能把它们算作同一个东西。
        def _object_key(url):
            path = urlparse(url).path.rstrip("/")
            return path.rsplit("/", 1)[-1] if path else url

        placeholder_urls = set()
        if media_col is not None:
            counts = {}
            for row_idx in range(2, ws.max_row + 1):
                value = ws.cell(row=row_idx, column=media_col).value
                if value and str(value).strip():
                    key = _object_key(str(value).strip())
                    counts[key] = counts.get(key, 0) + 1
            placeholder_urls = {u for u, n in counts.items() if n >= 3}
            if placeholder_urls:
                repeated = sum(counts[u] for u in placeholder_urls)
                self._log(
                    f"注意：表格里有 {repeated} 行共用 {len(placeholder_urls)} 个重复地址，"
                    f"这是采集工具没抓到真实地址时填的占位符，会被跳过。"
                )

        def _row_stored_link(row_idx):
            """这一行在表格里存着的地址。只用来判断该行是否需要处理，不联网。"""
            for col in (media_col, link_col):
                if col is None:
                    continue
                value = ws.cell(row=row_idx, column=col).value
                if value and str(value).strip():
                    return str(value).strip()
            return ""

        warned_rows = set()

        def _row_link(row_idx):
            """
            取这一行要下载的地址。

            **表格里存的地址优先**：实测抖音那个免签名接口对不同作品会返回同一个占位
            文件（下下来是静音），而采集工具写进表格的地址是每条不同的真货。只有表格
            里没有、或者已经过期时，才去问接口要一个新的。
            """
            # 表格已经写明是图集/图文的，直接跳过：没有音频，下什么都白搭
            if type_col is not None:
                kind = str(ws.cell(row=row_idx, column=type_col).value or "")
                if "图" in kind:
                    raise douyin_api.NoVideoError(f"{kind}作品，没有音频")

            stored = ""
            if media_col is not None:
                value = ws.cell(row=row_idx, column=media_col).value
                if value and str(value).strip():
                    stored = str(value).strip()

            stored_usable = bool(stored)
            if stored and _object_key(stored) in placeholder_urls:
                stored_usable = False   # 多行共用的占位地址，等于没有
            expiry = douyin_api.url_expiry(stored) if stored else None
            if expiry is not None and expiry < time.time():
                stored_usable = False   # 过期了，下载必然 403
            if stored_usable:
                return stored

            # 表格里这条不能用，才去问接口
            if api is not None and not api_unreliable["yes"]:
                aweme_id = douyin_api.extract_aweme_id(
                    ws.cell(row=row_idx, column=id_col).value if id_col else None
                ) or douyin_api.extract_aweme_id(
                    ws.cell(row=row_idx, column=link_col).value
                )
                if aweme_id:
                    try:
                        fresh = api.fresh_play_url(aweme_id)
                    except douyin_api.NoVideoError:
                        raise   # 图文/图集没有音频，换地址也没用
                    except douyin_api.DouyinApiError as exc:
                        self._log(f"    现取地址失败：{exc}")
                    else:
                        owner = api_urls.setdefault(fresh, aweme_id)
                        if owner != aweme_id:
                            api_unreliable["yes"] = True
                            self._log(
                                "接口对不同作品返回了同一个地址（占位内容），之后不再用它。"
                            )
                        elif _object_key(fresh) not in placeholder_urls:
                            return fresh

            if stored:
                raise PlaceholderUrlError(
                    "表格里这条是占位地址或已过期，接口也拿不到新的，需要重新采集"
                )
            value = ws.cell(row=row_idx, column=link_col).value
            return str(value).strip() if value else ""

        status_col = excel_core.find_column_index(header, "是否已经语音转写文案")
        if status_col is None:
            status_col = len(header) + 1
            ws.cell(row=1, column=status_col, value="是否已经语音转写文案")
            header.append("是否已经语音转写文案")

        transcript_col = excel_core.find_column_index(header, "逐字稿")
        if transcript_col is None:
            transcript_col = len(header) + 1
            ws.cell(row=1, column=transcript_col, value="逐字稿")
            header.append("逐字稿")

        video_id_col = excel_core.find_column_index(header, "作品id")

        pending_rows = []
        for row_idx in range(2, ws.max_row + 1):
            if not _row_stored_link(row_idx):
                continue
            if excel_core._is_marked_done(ws.cell(row=row_idx, column=status_col).value):
                continue
            pending_rows.append(row_idx)

        if not pending_rows:
            self._log("Excel 里没有待处理的行（可能都已经转写过了）。")
            return

        # 没有 cookies 就只能用表格里存的地址；如果那些地址已经过期，这一整批必然全军覆没。
        # 与其让用户盯着几百条 403 干等，不如开跑前就拦下来，把话说清楚。
        if api is None and media_col is not None:
            expiries = []
            for row_idx in pending_rows:
                value = ws.cell(row=row_idx, column=media_col).value
                exp = douyin_api.url_expiry(str(value)) if value else None
                if exp is not None:
                    expiries.append(exp)
            now = time.time()
            if expiries and all(e < now for e in expiries):
                hours = (now - max(expiries)) / 3600
                msg = (
                    f"这批没法跑，先别开始。\n\n"
                    f"表格里存的视频地址是带签名的临时地址，已经全部过期"
                    f"（最后一条过期了 {hours:.0f} 小时）。用过期地址下载，"
                    f"每一条都会是 403 失败。\n\n"
                    f"本来可以在下载前现去抖音要新地址，但这个功能没能启动"
                    f"（多半是依赖没装全）。\n\n"
                    f"解决办法：双击文件夹里的 install.command 重装一次依赖。\n"
                    f"实在不行，就用采集工具重新导一份表格，导完立刻转写。"
                )
                self._log(msg.replace("\n\n", "\n"))
                messagebox.showwarning("这批跑不了", msg)
                return

        success = 0
        failed = 0
        skipped = 0
        seen_links = {}
        api_urls = {}
        api_unreliable = {"yes": False}
        linked_rows = {"n": 0}

        # 开跑前先用两条不同的作品试一下接口：拿到的地址必须不一样。抖音的免签名接口
        # 实测会对所有作品返回同一个占位文件，那种地址下下来是静音，转写全是幻觉。
        # 在这里一次问清楚，就不用等某一行踩坑之后才发现。
        if api is not None:
            probes = {}
            for row_idx in pending_rows:
                aweme_id = douyin_api.extract_aweme_id(
                    ws.cell(row=row_idx, column=id_col).value if id_col else None
                ) or douyin_api.extract_aweme_id(ws.cell(row=row_idx, column=link_col).value)
                if not aweme_id or aweme_id in probes:
                    continue
                try:
                    probes[aweme_id] = api.fresh_play_url(aweme_id)
                except douyin_api.NoVideoError:
                    continue  # 图文作品，换下一条试
                except douyin_api.DouyinApiError as exc:
                    self._log(f"接口探测失败（{exc}），这一批只用表格里存的地址。")
                    api_unreliable["yes"] = True
                    break
                if len(probes) >= 2:
                    break
            if len(probes) >= 2 and len(set(probes.values())) == 1:
                api_unreliable["yes"] = True
                self._log(
                    "接口对两个不同作品返回了同一个地址（占位内容），这一批不用它，"
                    "只用表格里存的地址。"
                )
            elif probes and not api_unreliable["yes"]:
                self._log("接口探测通过：不同作品拿到不同地址，可以当备用来源。")

        self._log(f"共找到 {len(pending_rows)} 条待处理的行，开始处理...")

        stopped_early = False
        for idx, row_idx in enumerate(pending_rows, start=1):
            if self.stop_requested.is_set():
                stopped_early = True
                self._log("已停止，之前处理好的部分都已经保存在 Excel 里了。")
                break
            try:
                link = _row_link(row_idx)
                # 不同作品拿到同一个地址，说明接口没按作品返回对应视频。继续跑只会
                # 把同一段无关文字填满整张表，比直接失败更难发现，所以立刻停。
                if link and api is not None:
                    # 只数"真的拿到了地址"的行：被跳过的行不算，否则跳过一批之后
                    # 会把"只有一条链接"误判成"所有链接都一样"。
                    linked_rows["n"] += 1
                    seen_links.setdefault(link, row_idx)
                    linked = linked_rows["n"]
                    if len(seen_links) == 1 and linked >= 8:
                        msg = (
                            f"已停下，避免把错误内容写满表格。\n\n"
                            f"前 {linked} 条不同的作品都拿到了同一个视频地址：\n"
                            f"{link[:90]}\n\n"
                            f"说明抖音接口没有按作品 id 返回对应的视频，"
                            f"拿到的内容是错的。\n"
                            f"请把这个情况告诉我，先别重跑。"
                        )
                        self._log(msg.replace("\n\n", "\n"))
                        messagebox.showerror("地址重复，已停止", msg)
                        stopped_early = True
                        break
            except PlaceholderUrlError as exc:
                # 表格本身就没有这条的真实地址，跳过并写明，重新采集后再处理
                ws.cell(row=row_idx, column=transcript_col,
                        value="（表格里没有这条的真实视频地址，需要重新采集）")
                skipped += 1
                self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行跳过：{exc}")
                try:
                    wb.save(excel_path)
                except OSError as exc2:
                    self._log(f"保存 Excel 文件失败（可能文件正被 Excel/WPS 打开着）：{exc2}")
                    break
                continue
            except douyin_api.NoVideoError as exc:
                # 图文/图集没有音频，再试多少次都没用，标记掉免得每次重跑都卡在这
                ws.cell(row=row_idx, column=transcript_col,
                        value="（图文作品，没有音频可转写）")
                ws.cell(row=row_idx, column=status_col, value="True")
                skipped += 1
                self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行跳过：{exc}")
                try:
                    wb.save(excel_path)
                except OSError as exc2:
                    self._log(f"保存 Excel 文件失败（可能文件正被 Excel/WPS 打开着）：{exc2}")
                    break
                continue

            self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行，开始处理：{link}")
            audio_path = None
            try:
                audio_path, video_id, _title, thumbnail_url, video_path = core.download_audio(
                    link, tmp_dir, cookies_from_browser=cookies_from_browser,
                    cookies_file=self.cookies_file_var.get().strip(),
                    keep_video_dir=output_dir if self.keep_video_var.get() else None,
                )
                text, segments = core.transcribe_dispatch(audio_path, mode, transcribe_args)
                ws.cell(row=row_idx, column=transcript_col, value=core.clean_for_excel(text))
                ws.cell(row=row_idx, column=status_col, value="True")
                success += 1
                self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行成功。")
                self._log_result(f"【第 {row_idx} 行 {link}】\n{text}\n\n{'-' * 60}\n\n")

                # 除了写回表格，额外在输出目录里存一份独立的 txt（带时间戳）和封面图，
                # 方便单独查看/分享某一条
                excel_video_id = ws.cell(row=row_idx, column=video_id_col).value if video_id_col else None
                file_name = core.sanitize_filename(str(excel_video_id).strip() if excel_video_id else video_id)
                if video_path:
                    renamed_video_path = os.path.join(output_dir, f"{file_name}{os.path.splitext(video_path)[1]}")
                    try:
                        if renamed_video_path != video_path:
                            os.replace(video_path, renamed_video_path)
                        self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行：视频文件已保留到 {renamed_video_path}")
                    except OSError as exc:
                        self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行：视频文件已保留到 {video_path}（重命名失败：{exc}）")
                txt_path = os.path.join(output_dir, f"{file_name}.txt")
                try:
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(core.format_timestamped_text(segments, fallback_text=text))
                except OSError as exc:
                    self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行：写入独立 txt 文件失败：{exc}")
                core.download_cover_image(thumbnail_url, output_dir, file_name)
            except Exception as exc:  # noqa: BLE001
                ws.cell(row=row_idx, column=transcript_col, value=core.clean_for_excel(f"转写失败：{exc}"))
                failed += 1
                self._log(f"[{idx}/{len(pending_rows)}] 第 {row_idx} 行失败：{exc}")
                self._log_result(f"【第 {row_idx} 行 {link}】\n转写失败：{exc}\n\n{'-' * 60}\n\n")
            finally:
                if audio_path and os.path.isfile(audio_path):
                    try:
                        os.remove(audio_path)
                    except OSError:
                        pass
            try:
                wb.save(excel_path)
            except OSError as exc:
                self._log(f"保存 Excel 文件失败（可能文件正被 Excel/WPS 打开着）：{exc}")
                break

        if not stopped_early:
            summary = f"《{os.path.basename(excel_path)}》处理完成：成功 {success} 条，失败 {failed} 条"
            summary += f"，跳过 {skipped} 条（图文作品或表格里没有真实地址）。" if skipped else "。"
            self._log(summary)

    def _run_worker(self, links, mode, transcribe_args, output_dir, cookies_from_browser):
        """外层安全网：不管里面出什么没预料到的异常，都保证按钮状态能恢复。"""
        try:
            self._run_worker_impl(links, mode, transcribe_args, output_dir, cookies_from_browser)
        except Exception as exc:  # noqa: BLE001
            self._log(f"处理过程中发生未预料到的错误，已经停止：{exc}")
            self.is_running = False
            self.done_queue.put(True)

    def _run_worker_impl(self, links, mode, transcribe_args, output_dir, cookies_from_browser):
        expanded_links = []
        for link in links:
            try:
                found = core.expand_link_to_videos(
                    link, cookies_from_browser=cookies_from_browser,
                    cookies_file=self.cookies_file_var.get().strip(),
                )
            except Exception as exc:  # noqa: BLE001
                self._log(f"展开主页/合集失败，按单个视频处理：{link} -> {exc}")
                found = [link]
            if len(found) > 1:
                self._log(f"识别为主页/合集：{link} -> 展开为 {len(found)} 条视频链接")
            expanded_links.extend(found)
        links = list(dict.fromkeys(expanded_links))

        results = []
        total = len(links)
        stopped_early = False
        for idx, link in enumerate(links, start=1):
            if self.stop_requested.is_set():
                stopped_early = True
                self._log("已停止，之前处理好的部分会汇总进 Excel，不会丢。")
                break
            self._log(f"[{idx}/{total}] 开始处理：{link}")
            result = core.TranscriptResult(link=link)
            audio_path = None
            try:
                audio_path, video_id, title, thumbnail_url, video_path = core.download_audio(
                    link, output_dir, cookies_from_browser=cookies_from_browser,
                    cookies_file=self.cookies_file_var.get().strip(),
                    keep_video_dir=output_dir if self.keep_video_var.get() else None,
                )
                result.video_id = video_id
                result.title = title
                if video_path:
                    result.video_path = video_path
                    self._log(f"[{idx}/{total}] 视频文件已保留到 {video_path}")
                self._log(f"[{idx}/{total}] 音频下载完成，开始转写...")

                text, segments = core.transcribe_dispatch(audio_path, mode, transcribe_args)

                result.text = text
                result.status = "成功"
                self._log(f"[{idx}/{total}] 转写成功。")

                base_name = core.sanitize_filename(result.video_id or result.title)
                txt_path = os.path.join(output_dir, f"{base_name}.txt")
                with open(txt_path, "w", encoding="utf-8") as f:
                    f.write(core.format_timestamped_text(segments, fallback_text=result.text))

                cover_path = core.download_cover_image(thumbnail_url, output_dir, base_name)
                if cover_path:
                    result.cover_path = cover_path

                self._log_result(f"【{link}】\n{text}\n\n{'-' * 60}\n\n")
            except Exception as exc:  # noqa: BLE001
                result.status = "失败"
                result.message = str(exc)
                self._log(f"[{idx}/{total}] 失败：{exc}")
                self._log_result(f"【{link}】\n转写失败：{exc}\n\n{'-' * 60}\n\n")
            finally:
                if audio_path and os.path.isfile(audio_path):
                    try:
                        os.remove(audio_path)
                    except OSError:
                        pass
            results.append(result)

        if results:
            excel_path = core.export_excel(results, output_dir)
            if excel_path:
                self._log(f"汇总 Excel 已生成：{excel_path}")

        if not stopped_early:
            success_count = sum(1 for r in results if r.status == "成功")
            self._log(f"全部处理完成：成功 {success_count} 条，失败 {len(results) - success_count} 条。")

        self.is_running = False
        self.done_queue.put(True)


def main():
    # 打个版本戳：之前多次出现"跑的还是旧文件夹"，有这行一眼就能确认
    print(f"抖音视频逐字稿提取工具  build {BUILD}", flush=True)
    root = tk.Tk()
    TranscriptGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
