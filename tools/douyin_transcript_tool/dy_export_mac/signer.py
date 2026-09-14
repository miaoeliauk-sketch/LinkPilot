# -*- coding: utf-8 -*-
"""签名适配层 —— 全项目唯一的 a_bogus 生成入口。

当前实现基于 f2 0.0.1.7（Apache-2.0，允许闭源商用）。
若日后抖音更新导致签名失效或更换实现，只需修改这个文件。

注意：下面 UA 里的 "Windows NT 10.0" 是发给抖音服务器的浏览器指纹，
必须和 dy_export.py 里 BASE_PARAMS 的 os_name 保持一致，
跟你本机是 Mac 还是 Windows 无关，不要改。
"""
from f2.apps.douyin.utils import ABogusManager

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36")


def sign_url(url: str, params: dict) -> str:
    """给抖音接口 URL 附加 a_bogus 签名，返回可直接请求的完整 URL。"""
    return str(ABogusManager.model_2_endpoint(UA, url, params))
