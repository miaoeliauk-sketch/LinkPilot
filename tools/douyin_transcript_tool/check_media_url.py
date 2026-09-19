# -*- coding: utf-8 -*-
"""
快速体检：拿表格里的第一条"视频源网址"试一下，5 秒内告诉你能不能下载，
省得跑几百行才发现不行。

用法：
    python3 check_media_url.py 你的表格.xlsx
    python3 check_media_url.py "https://v3-web.douyinvod.com/...."
"""
import sys
import urllib.error
import urllib.request

REFERER = "https://www.douyin.com/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")


def first_media_url(xlsx_path):
    from openpyxl import load_workbook
    ws = load_workbook(xlsx_path, read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = [str(c or "") for c in next(rows)]
    if "视频源网址" not in header:
        raise SystemExit(
            f"❌ 这份表格里没有「视频源网址」这一列。实际的列名是：\n   {header}\n"
            "   没有这一列就绕不开抖音的下载限制，需要换个能导出这一列的采集工具。"
        )
    col = header.index("视频源网址")
    for row in rows:
        if col < len(row) and row[col] and str(row[col]).strip():
            return str(row[col]).strip()
    raise SystemExit("❌ 「视频源网址」这一列整列都是空的，等于没有。")


def probe(url, with_referer):
    headers = {"User-Agent": UA}
    if with_referer:
        headers["Referer"] = REFERER
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, (resp.headers.get("Content-Type") or "")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    arg = sys.argv[1]
    url = arg if arg.startswith("http") else first_media_url(arg)

    print(f"地址：{url[:100]}...\n" if len(url) > 100 else f"地址：{url}\n")

    code_no, _ = probe(url, with_referer=False)
    code_yes, ctype = probe(url, with_referer=True)
    print(f"不带 Referer：{code_no}")
    print(f"带  Referer：{code_yes}   {ctype}\n")

    if code_yes == 200:
        if code_no == 200:
            print("✅ 这个地址本来就能下，403 应该不是 Referer 的问题。")
        else:
            print("✅ 带上 Referer 就能下了——修复有效，可以放心跑整批。")
    elif code_yes == 403:
        print("❌ 带了 Referer 还是 403。说明这些地址已经失效了（带签名、会过期），\n"
              "   光靠改代码救不回来，需要重新采集一份新表格。")
    elif code_yes is None:
        print(f"❌ 连不上：{ctype}。先检查网络或梯子。")
    else:
        print(f"❌ 返回 {code_yes}，不是预期结果。把这个数字发给我。")


if __name__ == "__main__":
    main()
