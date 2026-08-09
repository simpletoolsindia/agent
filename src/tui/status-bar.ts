const ESC = "\x1B";

const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const BLUE = `${ESC}[34m`;
const MAGENTA = `${ESC}[35m`;
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const RICH_UI = {
  blue: BLUE,
  green: GREEN,
  yellow: YELLOW,
  cyan: CYAN,
  magenta: MAGENTA,
  dim: DIM,
  bold: BOLD,
  reset: RESET,
} as const;

export type StatusTone = "idle" | "busy" | "success" | "warn";
export type StatusMetric = {
  readonly label: string;
  readonly value: string;
  readonly tone?: StatusTone;
};


export function renderStatusBar(label: string, message: string, width: number, tone: StatusTone = "idle", progress?: number): string {
  const safeWidth = Math.max(20, width);
  const barWidth = Math.max(6, Math.min(16, Math.floor(safeWidth / 6)));
  const normalizedProgress = progress === undefined ? defaultProgress(tone) : Math.min(1, Math.max(0, progress));
  const filled = Math.round(barWidth * normalizedProgress);
  const color = toneColor(tone);
  const bar = `${color}${"▰".repeat(filled)}${DIM}${"▱".repeat(barWidth - filled)}${RESET}`;
  const prefix = `${DIM}╭${RESET} ${color}${BOLD}${label}${RESET} ${bar} ${DIM}│${RESET}`;
  const available = Math.max(0, safeWidth - visibleLength(prefix) - 1);
  return `${prefix} ${clipAnsi(message, available)}`;
}

export function renderActivityPulse(label: string, message: string, width: number, frame: number, tone: StatusTone = "busy"): string {
  const spinner = SPINNER_FRAMES[Math.abs(Math.trunc(frame)) % SPINNER_FRAMES.length];
  const wave = 0.5 + Math.sin(frame / 2) * 0.25;
  return renderStatusBar(`${spinner} ${label}`, message, width, tone, tone === "busy" ? wave : undefined);
}

export function renderCliPanel(title: string, rows: readonly string[], width: number = 88): string {
  const safeWidth = Math.max(48, width);
  const contentWidth = safeWidth - 4;
  return [
    `╭─ ${CYAN}${BOLD}${clipAnsi(title, Math.max(0, contentWidth - 3))}${RESET}${DIM}${"─".repeat(Math.max(0, contentWidth - visibleLength(title) - 2))}${RESET}╮`,
    ...rows.map((row) => framedPanelLine(row, contentWidth)),
    `╰${DIM}${"─".repeat(safeWidth - 2)}${RESET}╯`,
  ].join("\n");
}

export function renderCliSplash(model: string, cwd: string, approvalMode: string, width: number = 88): string {
  return renderCliPanel("Harness AI · rich cockpit", [
    `${CYAN}${BOLD}Five-tool coding cockpit${RESET} ${DIM}parallel search/read/bash · guarded write/update · resumable TUI${RESET}`,
    renderMetricStrip([
      { label: "model", value: model, tone: "busy" },
      { label: "approval", value: approvalMode, tone: approvalMode === "auto" ? "success" : "warn" },
      { label: "workspace", value: cwd, tone: "idle" },
    ], width - 4),
    renderProgressSteps(["prompt", "think", "tools", "verify", "done"], 0, width - 4),
    renderStatusBar("Ready", "Prompt accepted. Streaming agent work with live suggestions.", width - 4, "idle", 0.1),
  ], width);
}

export function renderMetricStrip(metrics: readonly StatusMetric[], width: number): string {
  const safeWidth = Math.max(20, width);
  const rendered = metrics.map((metric) => {
    const color = toneColor(metric.tone ?? "idle");
    return `${DIM}${metric.label}${RESET} ${color}${BOLD}${metric.value}${RESET}`;
  }).join(`${DIM}  │  ${RESET}`);
  return clipAnsi(rendered, safeWidth);
}

export function renderProgressSteps(steps: readonly string[], activeIndex: number, width: number): string {
  const safeWidth = Math.max(20, width);
  const active = Math.max(0, Math.min(Math.max(0, steps.length - 1), Math.trunc(activeIndex)));
  const rendered = steps.map((step, index) => {
    const color = index < active ? GREEN : index === active ? CYAN : DIM;
    const marker = index < active ? "●" : index === active ? "◆" : "○";
    return `${color}${marker} ${step}${RESET}`;
  }).join(`${DIM} ─ ${RESET}`);
  return clipAnsi(rendered, safeWidth);
}

export function renderKeyValueDeck(title: string, metrics: readonly StatusMetric[], width: number): string {
  const active = metrics.findIndex((metric) => (metric.tone ?? "idle") === "busy");
  return renderCliPanel(title, [
    renderMetricStrip(metrics, width - 4),
    renderProgressSteps(metrics.map((metric) => metric.label), active === -1 ? 0 : active, width - 4),
  ], width);
}

export function clipAnsi(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (visibleLength(text) <= width) {
    return text;
  }

  const target = Math.max(0, width - 1);
  let visible = 0;
  let output = "";
  for (let index = 0; index < text.length && visible < target;) {
    if (text[index] === ESC) {
      const end = ansiEndIndex(text, index);
      output += text.slice(index, end);
      index = end;
      continue;
    }
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    output += String.fromCodePoint(codePoint);
    visible += 1;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return `${output}…${RESET}`;
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}


function framedPanelLine(text: string, width: number): string {
  const clipped = clipAnsi(text, width);
  const padding = " ".repeat(Math.max(0, width - visibleLength(clipped)));
  return `│ ${clipped}${padding} │`;
}
function ansiEndIndex(text: string, start: number): number {
  const match = /\x1B\[[0-?]*[ -/]*[@-~]/.exec(text.slice(start));
  return match?.index === 0 ? start + match[0].length : start + 1;
}

function defaultProgress(tone: StatusTone): number {
  switch (tone) {
    case "busy":
      return 0.65;
    case "success":
      return 1;
    case "warn":
      return 0.35;
    case "idle":
      return 0;
  }
}

function toneColor(tone: StatusTone): string {
  switch (tone) {
    case "busy":
      return CYAN;
    case "success":
      return GREEN;
    case "warn":
      return YELLOW;
    case "idle":
      return MAGENTA;
  }
}
