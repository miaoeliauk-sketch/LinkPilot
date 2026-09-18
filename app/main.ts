import { app, BrowserWindow, ipcMain, shell } from "electron";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBannedPhrases, loadThresholds } from "../src/voice/config.js";
import { analyzeL1 } from "../src/voice/l1.js";

const APP_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const BUNDLED_CONFIG_DIRECTORY = join(APP_DIRECTORY, "..", "src", "voice", "config");

const CONFIG_FILES = ["banned-phrases.json", "thresholds.json"] as const;

/**
 * 词表和阈值放在用户数据目录，不放在应用包里——包里的文件改不了，
 * 而"加词不用改代码、不用发版"是这个工具的关键原则。
 * 首次启动从应用包里复制一份默认配置过去。
 */
function userConfigDirectory(): string {
  return join(app.getPath("userData"), "config");
}

async function ensureUserConfig(): Promise<void> {
  const target = userConfigDirectory();
  await mkdir(target, { recursive: true });

  for (const fileName of CONFIG_FILES) {
    const destination = join(target, fileName);
    try {
      await readFile(destination, "utf8");
    } catch {
      await copyFile(join(BUNDLED_CONFIG_DIRECTORY, fileName), destination);
    }
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: "口播体检",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#fbfbfa",
    show: false,
    webPreferences: {
      preload: join(APP_DIRECTORY, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 等首帧画好再显示，避免开窗时闪一下白屏
  window.once("ready-to-show", () => window.show());
  void window.loadFile(join(APP_DIRECTORY, "renderer", "index.html"));
  return window;
}

// 每次都重新读盘：改完词表直接再点一次体检就生效，不用重启应用
async function loadCurrentConfig() {
  const directory = userConfigDirectory();
  const [phrases, thresholds] = await Promise.all([
    loadBannedPhrases(join(directory, "banned-phrases.json")),
    loadThresholds(join(directory, "thresholds.json")),
  ]);
  return { phrases, thresholds };
}

ipcMain.handle("voicepilot:analyze", async (_event, text: unknown) => {
  if (typeof text !== "string") {
    throw new Error("待体检的文本必须是字符串");
  }

  const { phrases, thresholds } = await loadCurrentConfig();
  return analyzeL1(text, { phrases, thresholds });
});

ipcMain.handle("voicepilot:configVersions", async () => {
  const { phrases, thresholds } = await loadCurrentConfig();
  return { phrases: phrases.version, thresholds: thresholds.version };
});

ipcMain.handle("voicepilot:revealConfig", async () => {
  const directory = userConfigDirectory();
  shell.showItemInFolder(join(directory, "banned-phrases.json"));
});

void app.whenReady().then(async () => {
  await ensureUserConfig();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
