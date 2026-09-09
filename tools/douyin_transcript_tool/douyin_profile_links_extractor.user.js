// ==UserScript==
// @name         抖音主页视频链接提取器
// @namespace    douyin-transcript-tool
// @version      2.1.0
// @description  打开抖音博主主页时，自动滚动加载全部作品，提取视频链接及点赞/收藏/评论/发布日期，支持按点赞数/收藏数/发布日期区间筛选、按点赞或评论排序，再复制粘贴到"抖音视频批量逐字稿提取工具"里使用。
// @match        https://www.douyin.com/user/*
// @match        https://douyin.com/user/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * 背景说明：
 *   yt-dlp（我们批量转写工具依赖的下载库）目前不支持直接读取抖音"用户主页"链接
 *   （会报 Unsupported URL），所以没法在服务器/命令行侧直接"给一个主页链接就拿到全部视频"。
 *
 *   这个脚本换了个思路：不再尝试用程序去"请求"抖音的数据接口，而是让脚本运行在你
 *   自己已经登录的浏览器里，直接读取网页已经渲染好的内容（包括页面自带的点赞数/收藏数/
 *   评论数等统计信息），并自动往下滚动来触发"加载更多"，这样就不受服务器端接口限制的影响。
 *
 *   筛选后复制出来的每一行是"统计信息 + 链接"的格式（比如"👍12.3万 ⭐8000  https://...”），
 *   直接整段粘贴到 douyin_batch_transcript.py 的 links.txt 或者 douyin_transcript_gui.py
 *   的输入框里就能用——两边都是"从整段文本里自动挑出链接"的逻辑，前面的统计信息文字会被
 *   自动忽略，不用自己手动清理。
 *
 * 安装方式：
 *   1. 安装 Tampermonkey（或 Violentmonkey）浏览器扩展。
 *   2. 打开 Tampermonkey 管理面板，点"添加新脚本"，把这个文件的内容整个粘贴进去，保存。
 *   3. 打开任意一个抖音博主主页（网址形如 https://www.douyin.com/user/MS4w...），
 *      页面右下角会出现一个"提取本页视频链接"悬浮按钮。
 *
 * 局限说明：
 *   - 只能提取"当前网页已经加载/滚动到的内容"，如果博主作品特别多（几百上千条），
 *     可能需要多点几次"继续提取"或手动多滚动一会儿。
 *   - 依赖抖音网页的当前结构，如果抖音改版导致提取不到，需要更新脚本里的选择器。
 *   - 点赞数/收藏数是从页面已经加载的数据里读出来的，跟你在网页上看到的数字应该一致；
 *     极少数情况下页面数据里没有这个字段，会显示"未知"，筛选时这类视频会被当作 0 处理。
 */

(function () {
  "use strict";

  // videoId -> {id, url, digg, collect, comment, share, desc, createTime}
  const videoMap = new Map();

  function upsert(id, patch) {
    const existing = videoMap.get(id) || {
      id,
      url: `https://www.douyin.com/video/${id}`,
      digg: null,
      collect: null,
      comment: null,
      share: null,
      desc: "",
      createTime: null, // 秒级 unix 时间戳，发布日期筛选用
    };
    Object.assign(existing, patch);
    videoMap.set(id, existing);
  }

  function extractIdFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      const match = url.pathname.match(/\/(video|note)\/(\d+)/);
      return match ? match[2] : null;
    } catch (e) {
      return null;
    }
  }

  function collectFromDom() {
    document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]').forEach((a) => {
      const id = extractIdFromHref(a.getAttribute("href"));
      if (id) upsert(id, {});
    });
  }

  function collectFromScripts() {
    const roots = [];

    const renderNode = document.getElementById("RENDER_DATA");
    if (renderNode && renderNode.textContent) {
      try {
        roots.push(JSON.parse(decodeURIComponent(renderNode.textContent)));
      } catch (e) {
        // 忽略解析失败
      }
    }

    document
      .querySelectorAll('script[type="application/json"], script[id*="DATA"], script[id*="data"]')
      .forEach((script) => {
        if (!script.textContent || script === renderNode) return;
        try {
          roots.push(JSON.parse(script.textContent.trim()));
        } catch (e) {
          // 忽略解析失败
        }
      });

    function walk(value, seen) {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, seen));
        return;
      }
      const awemeId = value.aweme_id || value.awemeId || value.item_id || value.group_id || value.id_str;
      if (awemeId && (value.desc || value.title || value.video || value.share_url)) {
        const stats = value.statistics || value.stats || {};
        upsert(String(awemeId), {
          desc: value.desc || value.title || "",
          digg: numOrNull(stats.digg_count ?? stats.diggCount ?? value.digg_count),
          collect: numOrNull(stats.collect_count ?? stats.collectCount ?? value.collect_count),
          comment: numOrNull(stats.comment_count ?? stats.commentCount ?? value.comment_count),
          share: numOrNull(stats.share_count ?? stats.shareCount ?? value.share_count),
          createTime: numOrNull(value.create_time ?? value.createTime),
        });
      }
      Object.values(value).forEach((child) => {
        if (child && typeof child === "object") walk(child, seen);
      });
    }

    roots.forEach((root) => walk(root, new Set()));
  }

  function numOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function collectAll() {
    collectFromDom();
    collectFromScripts();
    return Array.from(videoMap.values());
  }

  async function autoScrollAndCollect(onProgress) {
    let stableRounds = 0;
    let previousCount = 0;
    const maxScrolls = 80;

    for (let i = 0; i < maxScrolls; i += 1) {
      const currentCount = collectAll().length;
      if (onProgress) onProgress(currentCount, i, maxScrolls);

      if (currentCount <= previousCount) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
        previousCount = currentCount;
      }
      if (stableRounds >= 6) break;

      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      await new Promise((resolve) => setTimeout(resolve, 900));
    }

    return collectAll();
  }

  function formatCount(n) {
    if (n === null || n === undefined) return "未知";
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return String(n);
  }

  function formatDate(createTime) {
    if (!createTime) return "日期未知";
    const d = new Date(createTime * 1000);
    if (Number.isNaN(d.getTime())) return "日期未知";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function renderFiltered(resultEl, statusEl, options) {
    const { minDigg, minCollect, dateStart, dateEnd, sort } = options;
    const startTs = dateStart ? new Date(`${dateStart}T00:00:00`).getTime() / 1000 : null;
    // 结束日期取到当天 23:59:59，这样筛选区间包含结束日期当天发布的作品
    const endTs = dateEnd ? new Date(`${dateEnd}T23:59:59`).getTime() / 1000 : null;

    const videos = Array.from(videoMap.values());
    let filtered = videos.filter((v) => {
      const digg = v.digg ?? 0;
      const collect = v.collect ?? 0;
      if (digg < minDigg || collect < minCollect) return false;
      if (startTs !== null || endTs !== null) {
        // 拿不到发布日期的作品，在设了日期区间时直接排除，避免把日期不明的内容混进筛选结果
        if (!v.createTime) return false;
        if (startTs !== null && v.createTime < startTs) return false;
        if (endTs !== null && v.createTime > endTs) return false;
      }
      return true;
    });

    if (sort === "digg_desc") {
      filtered = filtered.slice().sort((a, b) => (b.digg ?? 0) - (a.digg ?? 0));
    } else if (sort === "comment_desc") {
      filtered = filtered.slice().sort((a, b) => (b.comment ?? 0) - (a.comment ?? 0));
    }

    const lines = filtered.map(
      (v) => `👍${formatCount(v.digg)} ⭐${formatCount(v.collect)} 📅${formatDate(v.createTime)}  ${v.url}`
    );
    resultEl.value = lines.join("\n");
    statusEl.textContent =
      `共抓到 ${videos.length} 条视频，筛选（点赞≥${minDigg}、收藏≥${minCollect}` +
      `${dateStart || dateEnd ? `、发布日期 ${dateStart || "不限"} ~ ${dateEnd || "不限"}` : ""}` +
      `）后剩 ${filtered.length} 条`;
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
      "max-height:75vh",
      "display:flex",
      "flex-direction:column",
      "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif",
      "font-size:13px",
    ].join(";");

    panel.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;">抖音主页视频链接提取器</div>
      <div id="dyle-status" style="color:#666;margin-bottom:8px;">点击下方按钮开始提取（会自动滚动页面）</div>
      <button id="dyle-start" style="padding:6px 10px;margin-bottom:8px;cursor:pointer;">开始提取本页视频链接</button>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <label style="white-space:nowrap;">最低点赞数：</label>
        <input id="dyle-min-digg" type="number" min="0" value="0" style="width:70px;" />
        <label style="white-space:nowrap;">最低收藏数：</label>
        <input id="dyle-min-collect" type="number" min="0" value="0" style="width:70px;" />
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <label style="white-space:nowrap;">发布日期：</label>
        <input id="dyle-date-start" type="date" style="width:130px;" />
        <span>至</span>
        <input id="dyle-date-end" type="date" style="width:130px;" />
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <label style="white-space:nowrap;">排序：</label>
        <select id="dyle-sort" style="flex:1;">
          <option value="default">默认顺序</option>
          <option value="digg_desc">点赞从高到低</option>
          <option value="comment_desc">评论从高到低</option>
        </select>
      </div>
      <button id="dyle-filter" style="padding:6px 10px;margin-bottom:8px;cursor:pointer;">应用筛选</button>
      <textarea id="dyle-result" style="flex:1;min-height:160px;resize:vertical;font-size:12px;" placeholder="提取结果会显示在这里，可以直接整段复制粘贴到转写工具里（前面的点赞/收藏数文字会被自动忽略）"></textarea>
      <button id="dyle-copy" style="padding:6px 10px;margin-top:8px;cursor:pointer;">复制以上链接</button>
    `;

    document.body.appendChild(panel);

    const statusEl = panel.querySelector("#dyle-status");
    const startBtn = panel.querySelector("#dyle-start");
    const filterBtn = panel.querySelector("#dyle-filter");
    const resultEl = panel.querySelector("#dyle-result");
    const copyBtn = panel.querySelector("#dyle-copy");
    const minDiggEl = panel.querySelector("#dyle-min-digg");
    const minCollectEl = panel.querySelector("#dyle-min-collect");
    const dateStartEl = panel.querySelector("#dyle-date-start");
    const dateEndEl = panel.querySelector("#dyle-date-end");
    const sortEl = panel.querySelector("#dyle-sort");

    const readFilterOptions = () => ({
      minDigg: Number(minDiggEl.value) || 0,
      minCollect: Number(minCollectEl.value) || 0,
      dateStart: dateStartEl.value || "",
      dateEnd: dateEndEl.value || "",
      sort: sortEl.value || "default",
    });

    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      startBtn.textContent = "提取中...";
      await autoScrollAndCollect((count, round, total) => {
        statusEl.textContent = `已找到 ${count} 条视频（滚动进度 ${round + 1}/${total}）`;
      });
      renderFiltered(resultEl, statusEl, readFilterOptions());
      startBtn.disabled = false;
      startBtn.textContent = "重新提取（继续往下滚动加载更多）";
    });

    filterBtn.addEventListener("click", () => {
      renderFiltered(resultEl, statusEl, readFilterOptions());
    });

    copyBtn.addEventListener("click", () => {
      resultEl.select();
      document.execCommand("copy");
      statusEl.textContent = "已复制到剪贴板，可以去粘贴到转写工具了（工具会自动只识别链接，前面的点赞/收藏数文字不影响使用）";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildPanel);
  } else {
    buildPanel();
  }
})();
