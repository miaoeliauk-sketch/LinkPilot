// ==UserScript==
// @name         微信视频号视频地址抓取器
// @namespace    douyin-transcript-tool
// @version      0.1.0（实验版，需要你实际测试反馈）
// @description  在视频号网页版播放视频时，自动记录网络请求里出现的视频/媒体地址候选项，方便手动挑出真实播放地址后单独下载。
// @match        https://channels.weixin.qq.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/*
 * 重要说明（务必先看）：
 *
 *   这是一个"实验版"脚本，跟同目录下的 douyin_profile_links_extractor.user.js
 *   不是一回事——抖音那个脚本的原理（直接读取网页已经渲染好的数据）已经经过实际
 *   测试验证；这个视频号脚本目前只是按公开资料里"抓包找视频真实地址"的原理写的，
 *   我没有条件在这个开发环境里用真实的视频号账号登录测试，所以：
 *
 *     - 不保证一装上就能用，很可能需要你实际打开一个视频号视频、看这个脚本
 *       抓到了什么，把结果反馈给我，再针对性调整。
 *     - 抓到的候选地址不一定就是能直接下载的真实视频文件，有可能是签名过期
 *       很快失效的临时链接，也可能抓到的是缩略图/字幕/弹幕之类的其它请求。
 *
 * 原理：
 *   视频号网页版播放视频时，视频文件本身要么直接被赋值到 <video> 标签的
 *   src/currentSrc 上，要么通过 fetch/XMLHttpRequest 请求拿到播放地址（也可能藏在
 *   某个 API 响应的 JSON 字段里）。这个脚本做了两件事：
 *     1. 监听页面里所有 <video> 标签，记录它们的 currentSrc（如果视频号直接把
 *        真实地址赋给 video 标签，这里就能直接拿到）。
 *     2. 拦截 window.fetch 和 XMLHttpRequest，记录所有"看起来像视频/媒体请求"的
 *        网络请求地址和返回内容里出现的 url 字段（如果视频号是通过接口返回播放
 *        地址，这里能兜底抓到）。
 *   两种途径抓到的结果都会列在页面右下角的悬浮面板里，你自己判断/测试哪个是真正
 *   能用的视频地址。
 *
 * 使用方式：
 *   1. 装到 Tampermonkey 里（跟抖音那个脚本装法一样）。
 *   2. 登录视频号网页版，打开一个视频号视频详情页，让它正常播放几秒。
 *   3. 看右下角面板，"候选地址"列表里应该会出现一些链接；点每一条后面的"复制"，
 *      在新标签页/下载工具里试一下这个链接能不能直接打开/下载出正常的视频文件。
 *   4. 把测试结果（能用 / 不能用 / 完全没抓到任何东西）告诉我，我再继续调整。
 */

(function () {
  "use strict";

  const candidates = new Map(); // url -> {url, source, firstSeen, sizeHint}
  const MEDIA_URL_HINT = /\.(mp4|m3u8|ts)(\?|$)/i;
  const MEDIA_KEYWORD_HINT = /(video|media|playurl|mmfinder|vid=|finder)/i;

  function looksLikeMedia(url) {
    if (!url || typeof url !== "string") return false;
    return MEDIA_URL_HINT.test(url) || MEDIA_KEYWORD_HINT.test(url);
  }

  function record(url, source) {
    if (!looksLikeMedia(url)) return;
    if (candidates.has(url)) return;
    candidates.set(url, { url, source, firstSeen: new Date().toLocaleTimeString() });
    refreshPanelList();
  }

  // -------------------- 拦截 fetch --------------------
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (...args) {
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
        record(url, "fetch请求地址");
      } catch (e) {
        // 忽略
      }
      const result = originalFetch.apply(this, args);
      result
        .then((resp) => resp.clone().text())
        .then((text) => {
          scanTextForUrls(text, "fetch响应内容");
        })
        .catch(() => {});
      return result;
    };
  }

  // -------------------- 拦截 XMLHttpRequest --------------------
  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const originalOpen = OriginalXHR.prototype.open;
    OriginalXHR.prototype.open = function (method, url, ...rest) {
      try {
        record(url, "XHR请求地址");
      } catch (e) {
        // 忽略
      }
      this.addEventListener("load", () => {
        try {
          scanTextForUrls(this.responseText, "XHR响应内容");
        } catch (e) {
          // 忽略（比如 responseType 不是文本）
        }
      });
      return originalOpen.call(this, method, url, ...rest);
    };
  }

  function scanTextForUrls(text, source) {
    if (!text || typeof text !== "string" || text.length > 2_000_000) return;
    // 从任意 JSON/文本响应里，粗暴地把形如 "url":"https://..." 或裸露的 https://...mp4 地址挖出来
    const patterns = [
      /"(?:url|play_?url|video_?url|media_?url)"\s*:\s*"([^"]+)"/gi,
      /(https?:\/\/[^\s"']+\.(?:mp4|m3u8)(?:\?[^\s"']*)?)/gi,
    ];
    patterns.forEach((re) => {
      let match;
      while ((match = re.exec(text)) !== null) {
        const raw = match[1].replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");
        record(raw, source);
      }
    });
  }

  // -------------------- 监听 <video> 标签 --------------------
  function watchVideoElements() {
    const seen = new WeakSet();
    function attach(video) {
      if (seen.has(video)) return;
      seen.add(video);
      const report = () => {
        if (video.currentSrc) record(video.currentSrc, "video标签currentSrc");
      };
      video.addEventListener("loadedmetadata", report);
      video.addEventListener("canplay", report);
      report();
    }
    document.querySelectorAll("video").forEach(attach);
    new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.tagName === "VIDEO") attach(node);
          node.querySelectorAll && node.querySelectorAll("video").forEach(attach);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // -------------------- 悬浮面板 --------------------
  let listEl = null;
  let statusEl = null;

  function refreshPanelList() {
    if (!listEl) return;
    const items = Array.from(candidates.values()).reverse();
    if (statusEl) statusEl.textContent = `共抓到 ${items.length} 条候选地址`;
    listEl.innerHTML = items
      .map(
        (item, idx) => `
        <div style="border-bottom:1px solid #eee;padding:6px 0;">
          <div style="color:#888;font-size:11px;">[${item.firstSeen}] ${item.source}</div>
          <div style="word-break:break-all;font-size:12px;margin:2px 0;">${item.url}</div>
          <button data-idx="${idx}" class="dysniff-copy" style="padding:3px 8px;cursor:pointer;">复制这条</button>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".dysniff-copy").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items[Number(btn.dataset.idx)];
        if (!item) return;
        navigator.clipboard
          .writeText(item.url)
          .then(() => {
            btn.textContent = "已复制";
            setTimeout(() => (btn.textContent = "复制这条"), 1200);
          })
          .catch(() => {
            // 剪贴板 API 在部分环境下需要用户手势触发，这里已经是点击事件里了，理论上没问题；
            // 万一失败就退回选中文本的老办法
            const range = document.createRange();
            const temp = document.createElement("textarea");
            temp.value = item.url;
            document.body.appendChild(temp);
            temp.select();
            document.execCommand("copy");
            document.body.removeChild(temp);
            btn.textContent = "已复制";
            setTimeout(() => (btn.textContent = "复制这条"), 1200);
          });
      });
    });
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:20px",
      "z-index:999999",
      "background:#ffffff",
      "border:1px solid #ddd",
      "border-radius:10px",
      "box-shadow:0 4px 16px rgba(0,0,0,0.2)",
      "padding:12px",
      "width:380px",
      "max-height:70vh",
      "display:flex",
      "flex-direction:column",
      "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif",
      "font-size:13px",
    ].join(";");

    panel.innerHTML = `
      <div style="font-weight:bold;margin-bottom:4px;">视频号视频地址抓取器（实验版）</div>
      <div style="color:#c00;font-size:11px;margin-bottom:8px;">
        实验性质，抓到的地址不一定能直接下载，请自己测试后反馈效果
      </div>
      <div id="dysniff-status" style="color:#666;margin-bottom:8px;">播放一个视频号视频，这里会自动列出候选地址...</div>
      <div id="dysniff-list" style="flex:1;overflow-y:auto;min-height:160px;"></div>
    `;

    document.body.appendChild(panel);
    statusEl = panel.querySelector("#dysniff-status");
    listEl = panel.querySelector("#dysniff-list");
  }

  function init() {
    watchVideoElements();
    buildPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
