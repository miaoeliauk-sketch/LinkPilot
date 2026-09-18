import type { L1Report, RuleId, SentenceResult } from "../../src/voice/types.js";

declare global {
  interface Window {
    voicepilot: {
      analyze(text: string): Promise<L1Report>;
      configVersions(): Promise<{ phrases: string; thresholds: string }>;
      revealConfig(): Promise<void>;
      platform: string;
    };
  }
}

const RULE_LABELS: Record<RuleId, string> = {
  "banned-phrase": "指纹词",
  parallelism: "三连排比",
  "overlong-sentence": "超长句",
};

/** 句子底部下划线只表示整句级别的问题；指纹词有字级高亮，不再重复画线 */
const UNDERLINE_PRIORITY: RuleId[] = ["parallelism", "overlong-sentence"];

const STAGGER_STEP_MS = 40;
const STAGGER_CAP_MS = 240;

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`界面缺少元素 #${id}`);
  }
  return found as T;
};

const stage = element<HTMLElement>("stage");
const editor = element<HTMLElement>("editor");
const report = element<HTMLElement>("report");
const input = element<HTMLTextAreaElement>("script-input");
const runButton = element<HTMLButtonElement>("run");
const backButton = element<HTMLButtonElement>("back");
const revealButton = element<HTMLButtonElement>("reveal-config");
const shortcutHint = element<HTMLElement>("run-shortcut");
const charHint = element<HTMLElement>("char-hint");
const configBadge = element<HTMLElement>("config-badge");
const sourceView = element<HTMLElement>("source");
const metricsView = element<HTMLElement>("metrics");
const warningsView = element<HTMLElement>("warnings");
const hitsView = element<HTMLElement>("hits");

const isMac = window.voicepilot?.platform === "darwin";
shortcutHint.textContent = isMac ? "⌘↩" : "Ctrl+↩";
document.body.dataset.platform = window.voicepilot?.platform ?? "";

let currentText = "";

function setConfigBadge(versions: { phrases: string; thresholds: string }) {
  configBadge.textContent = `${versions.phrases} · ${versions.thresholds}`;
}

/** 标点和空白不计入字数，和引擎口径保持一致 */
const NON_COUNTING = /[\p{P}\p{S}\s]/u;

function countChars(text: string): number {
  let count = 0;
  for (const character of text) {
    if (!NON_COUNTING.test(character)) {
      count += 1;
    }
  }
  return count;
}

function updateCharHint() {
  charHint.textContent = `${countChars(input.value)} 字`;
  runButton.disabled = input.value.trim().length === 0;
}

function showView(view: "edit" | "report", instant: boolean) {
  const entering = view === "edit" ? editor : report;
  const leaving = view === "edit" ? report : editor;

  stage.toggleAttribute("data-instant", instant);
  stage.dataset.view = view;
  leaving.hidden = true;
  entering.hidden = false;

  if (instant) {
    return;
  }

  entering.setAttribute("data-entering", "");
  // 强制一次样式计算，让浏览器把起始状态记下来，过渡才会真的跑
  void entering.offsetHeight;
  entering.removeAttribute("data-entering");
}

interface Range {
  start: number;
  end: number;
}

/** 同一句里多个指纹词可能重叠，先合并成互不相交的高亮区间 */
function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: Range[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }

  return merged;
}

function markedSentence(sentence: SentenceResult): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const ranges = mergeRanges(
    sentence.hits
      .filter((hit) => hit.match)
      .map((hit) => {
        const start = sentence.text.indexOf(hit.match!);
        return start < 0 ? null : { start, end: start + hit.match!.length };
      })
      .filter((range): range is Range => range !== null),
  );

  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      fragment.append(sentence.text.slice(cursor, range.start));
    }
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = sentence.text.slice(range.start, range.end);
    fragment.append(mark);
    cursor = range.end;
  }
  if (cursor < sentence.text.length) {
    fragment.append(sentence.text.slice(cursor));
  }

  return fragment;
}

function renderSource(text: string, sentences: SentenceResult[]) {
  sourceView.replaceChildren();
  let cursor = 0;

  for (const sentence of sentences) {
    if (sentence.start > cursor) {
      // 句子之间的换行和空格原样保留，否则原文的段落形状就没了
      sourceView.append(text.slice(cursor, sentence.start));
    }

    const span = document.createElement("span");
    span.className = "sentence";
    span.id = `sentence-${sentence.index}`;
    span.append(markedSentence(sentence));

    const underline = UNDERLINE_PRIORITY.find((rule) =>
      sentence.hits.some((hit) => hit.rule === rule),
    );
    if (underline) {
      span.dataset.rule = underline;
    }

    sourceView.append(span);
    cursor = sentence.end;
  }

  if (cursor < text.length) {
    sourceView.append(text.slice(cursor));
  }
}

function renderMetrics(report_: L1Report) {
  const { metrics } = report_;
  const overLength = report_.warnings.length > 0;
  const tiles: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: "句数", value: String(metrics.sentenceCount) },
    { label: "总字数", value: String(metrics.totalCharCount) },
    {
      label: "平均句长",
      value: `${metrics.averageSentenceLength}`,
      warn: overLength && metrics.averageSentenceLength > 0,
    },
    { label: "最长句", value: String(metrics.maxSentenceLength) },
    { label: "指纹词", value: String(metrics.bannedPhraseHitCount), warn: metrics.bannedPhraseHitCount > 0 },
    { label: "三连排比", value: String(metrics.parallelismHitCount), warn: metrics.parallelismHitCount > 0 },
  ];

  metricsView.replaceChildren();
  for (const tile of tiles) {
    const wrapper = document.createElement("div");
    wrapper.className = "metric";
    if (tile.warn) {
      wrapper.dataset.warn = "";
    }

    const label = document.createElement("span");
    label.className = "metric__label";
    label.textContent = tile.label;

    const value = document.createElement("span");
    value.className = "metric__value";
    value.textContent = tile.value;

    wrapper.append(label, value);
    metricsView.append(wrapper);
  }
}

function focusSentence(index: number) {
  for (const marked of sourceView.querySelectorAll("[data-focused]")) {
    marked.removeAttribute("data-focused");
  }
  const target = document.getElementById(`sentence-${index}`);
  if (!target) {
    return;
  }
  target.setAttribute("data-focused", "");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderHits(sentences: SentenceResult[]) {
  hitsView.replaceChildren();
  const flagged = sentences.filter((sentence) => sentence.hits.length > 0);

  if (flagged.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "逐句命中：无。L1 规则层没挑出问题。";
    hitsView.append(empty);
    return;
  }

  let position = 0;
  for (const sentence of flagged) {
    for (const hit of sentence.hits) {
      const card = document.createElement("button");
      card.className = "hit";
      card.type = "button";
      card.style.animationDelay = `${Math.min(position * STAGGER_STEP_MS, STAGGER_CAP_MS)}ms`;
      position += 1;

      const head = document.createElement("div");
      head.className = "hit__head";

      const rule = document.createElement("span");
      rule.className = "hit__rule";
      rule.dataset.rule = hit.rule;
      rule.textContent = RULE_LABELS[hit.rule];

      const index = document.createElement("span");
      index.className = "hit__index";
      index.textContent = `第 ${sentence.index + 1} 句`;

      head.append(rule, index);

      const detail = document.createElement("div");
      detail.className = "hit__detail";
      detail.textContent = hit.detail;

      card.append(head, detail);
      card.addEventListener("click", () => focusSentence(sentence.index));
      hitsView.append(card);
    }
  }
}

function renderWarnings(warnings: string[]) {
  warningsView.replaceChildren();
  for (const warning of warnings) {
    const item = document.createElement("p");
    item.className = "warning";
    item.textContent = warning;
    warningsView.append(item);
  }
}

async function run(fromKeyboard: boolean) {
  const text = input.value;
  if (!text.trim()) {
    return;
  }

  runButton.disabled = true;
  try {
    const result = await window.voicepilot.analyze(text);
    currentText = text;

    setConfigBadge(result.configVersion);
    renderSource(currentText, result.sentences);
    renderMetrics(result);
    renderWarnings(result.warnings);
    renderHits(result.sentences);

    // 重新挂 data-stagger 才能让浮现动画再跑一次
    hitsView.removeAttribute("data-stagger");
    void hitsView.offsetHeight;
    if (!fromKeyboard) {
      hitsView.setAttribute("data-stagger", "");
    }

    showView("report", fromKeyboard);
  } catch (error) {
    charHint.textContent =
      error instanceof Error ? error.message : "体检失败，原因未知";
  } finally {
    runButton.disabled = input.value.trim().length === 0;
  }
}

input.addEventListener("input", updateCharHint);

runButton.addEventListener("click", () => {
  void run(false);
});

backButton.addEventListener("click", () => {
  showView("edit", false);
  input.focus();
});

revealButton.addEventListener("click", () => {
  void window.voicepilot.revealConfig();
});

document.addEventListener("keydown", (event) => {
  const withModifier = isMac ? event.metaKey : event.ctrlKey;

  if (withModifier && event.key === "Enter") {
    event.preventDefault();
    void run(true);
    return;
  }

  if (event.key === "Escape" && stage.dataset.view === "report") {
    event.preventDefault();
    showView("edit", true);
    input.focus();
  }
});

updateCharHint();
input.focus();

// 启动就把版本号显示出来，不用等第一次体检
void window.voicepilot
  .configVersions()
  .then(setConfigBadge)
  .catch((error: unknown) => {
    configBadge.textContent =
      error instanceof Error ? `词表读取失败：${error.message}` : "词表读取失败";
  });
