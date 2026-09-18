/*
 * 桌面应用冒烟测试：真的起一个 Electron 窗口，真的走 IPC 跑一遍体检，
 * 检查界面渲染结果、点击定位、深色模式和控制台是否干净，并留下截图。
 *
 * 这个文件是 Electron 的主入口，所以必须是 .mjs 而不是 .ts，
 * 而且入口里不能有顶层 await——Electron 要等主入口模块求值完成才触发 ready。
 *
 * 跑法：pnpm app:smoke（Linux 无显示器时用 xvfb-run 包一层）
 */
import { app, BrowserWindow, nativeTheme } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "tmp", "smoke");
const OVERALL_TIMEOUT_MS = 90_000;

const SCRIPT = [
  "你有没有发现，好的设计都很安静。",
  "它不吵闹，不张扬，不刻意。",
  "真正的质感从来都不是靠堆砌出来的，而是靠一层一层的克制慢慢沉淀下来的。",
  "这种细腻的、治愈的、沉浸式的体验，值得你慢慢感受。",
  "希望对你有帮助，评论区聊聊。",
].join("\n");

const failures = [];
const consoleProblems = [];
const wait = (ms) => new Promise((resolve_) => setTimeout(resolve_, ms));

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "  ok" : "FAIL"}  ${label}：${JSON.stringify(actual)}`);
  if (!ok) {
    failures.push(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

setTimeout(() => {
  console.error("FAIL: 冒烟测试整体超时");
  app.exit(1);
}, OVERALL_TIMEOUT_MS);

await import(join(ROOT, "dist-app", "app", "main.js"));

app.whenReady().then(async () => {
  await mkdir(SHOTS, { recursive: true });

  let window = null;
  for (let attempt = 0; attempt < 60 && !window; attempt += 1) {
    await wait(100);
    window = BrowserWindow.getAllWindows()[0] ?? null;
  }
  if (!window) {
    console.error("FAIL: 没有创建出窗口");
    return app.exit(1);
  }

  window.webContents.on("console-message", (event) => {
    if (event?.level === "error" || event?.level === "warning") {
      consoleProblems.push(`[${event.level}] ${event.message}`);
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    consoleProblems.push(`渲染进程崩溃：${JSON.stringify(details)}`);
  });

  const shoot = async (name) => {
    const image = await window.capturePage();
    await writeFile(join(SHOTS, `${name}.png`), image.toPNG());
  };

  await wait(1000);

  // 启动时就该有词表版本号，不能停在“未加载”
  const badgeOnBoot = await window.webContents.executeJavaScript(
    `document.getElementById("config-badge").textContent`,
  );
  check("启动即显示词表版本", badgeOnBoot.includes("banned-phrases-v0"), true);
  await shoot("1-edit-empty");

  const charHint = await window.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById("script-input");
      input.value = ${JSON.stringify(SCRIPT)};
      input.dispatchEvent(new Event("input"));
      return document.getElementById("char-hint").textContent;
    })()
  `);
  check("字数与引擎口径一致", charHint, "90 字");
  await shoot("2-edit-filled");

  // 真实 IPC：点按钮 → 主进程读词表 → 跑 L1 → 回传报告
  await window.webContents.executeJavaScript(`document.getElementById("run").click(); true;`);
  await wait(1500);
  await shoot("3-report");

  const summary = await window.webContents.executeJavaScript(`
    (() => ({
      view: document.getElementById("stage").dataset.view,
      hits: document.querySelectorAll(".hit").length,
      marks: document.querySelectorAll(".mark").length,
      underlined: document.querySelectorAll(".sentence[data-rule]").length,
      metrics: [...document.querySelectorAll(".metric__value")].map((node) => node.textContent),
    }))()
  `);
  check("切到报告视图", summary.view, "report");
  check("指标与 CLI 一致", summary.metrics, ["5", "90", "18", "33", "8", "1"]);
  check("命中卡片数", summary.hits, 9);
  check("原文里的字级高亮数", summary.marks, 7);
  check("整句级下划线数", summary.underlined, 1);

  await window.webContents.executeJavaScript(`document.querySelector(".hit").click(); true;`);
  await wait(600);
  const focused = await window.webContents.executeJavaScript(
    `document.querySelectorAll("[data-focused]").length`,
  );
  check("点命中能定位到句子", focused, 1);
  await shoot("4-focused");

  nativeTheme.themeSource = "dark";
  await wait(500);
  await shoot("5-dark");
  nativeTheme.themeSource = "system";

  // 非法输入要被主进程挡住，而且不能把应用搞崩
  const rejection = await window.webContents.executeJavaScript(`
    (async () => {
      try { await window.voicepilot.analyze(123); return "没有抛错"; }
      catch (error) { return String(error.message || error); }
    })()
  `);
  check("非法输入被拒绝", rejection.includes("必须是字符串"), true);

  const alive = await window.webContents.executeJavaScript(`!!document.getElementById("run")`);
  check("出错后界面仍然活着", alive, true);

  if (consoleProblems.length > 0) {
    failures.push(`控制台不干净：\n${consoleProblems.join("\n")}`);
  }

  if (failures.length > 0) {
    console.error(`\n冒烟测试失败 ${failures.length} 项：\n- ${failures.join("\n- ")}`);
    return app.exit(1);
  }

  console.log(`\n冒烟测试全部通过，截图在 ${SHOTS}`);
  app.exit(0);
});
