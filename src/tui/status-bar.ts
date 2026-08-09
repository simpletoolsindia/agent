const ESC = "\x1B";

const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const BLUE = `${ESC}[34m`;
const ACCENT_BLUE = `${ESC}[94m`;
const GRAY = `${ESC}[90m`;
const BRIGHT_WHITE = `${ESC}[97m`;
const BRIGHT_YELLOW = `${ESC}[93m`;
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const RICH_UI = {
  blue: BLUE,
  green: GREEN,
  yellow: YELLOW,
  cyan: CYAN,
  gray: GRAY,
  brightWhite: BRIGHT_WHITE,
  brightYellow: BRIGHT_YELLOW,
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


/** Renders the single-line progress/status row used by CLI and TUI stream hints. */
export function renderStatusBar(label: string, message: string, width: number, tone: StatusTone = "idle", progress?: number): string {
  const safeWidth = Math.max(20, width);
  const barWidth = Math.max(8, Math.min(22, Math.floor(safeWidth / 5)));
  const normalizedProgress = progress === undefined ? defaultProgress(tone) : Math.min(1, Math.max(0, progress));
  const color = toneColor(tone);
  const bar = renderProgressBar({
    current: Math.round(normalizedProgress * 100),
    total: 100,
    width: barWidth,
    gradient: tone !== "idle",
  });
  const percent = `${Math.round(normalizedProgress * 100).toString().padStart(3)}%`;
  const prefix = `${DIM}╭─${RESET} ${color}${BOLD}${label}${RESET} ${bar} ${BRIGHT_WHITE}${BOLD}${percent}${RESET} ${DIM}│${RESET}`;
  const available = Math.max(0, safeWidth - visibleLength(prefix) - 1);
  return `${prefix} ${clipAnsi(message, available)}`;
}

export function renderActivityPulse(label: string, message: string, width: number, frame: number, tone: StatusTone = "busy"): string {
  const spinner = SPINNER_FRAMES[Math.abs(Math.trunc(frame)) % SPINNER_FRAMES.length];
  const wave = 0.5 + Math.sin(frame / 2) * 0.25;
  const animatedLabel = tone === "busy" ? renderShimmerText(label, frame) : label;
  return renderStatusBar(`${spinner} ${animatedLabel}`, message, width, tone, tone === "busy" ? wave : undefined);
}

export type ProgressBarRenderOptions = {
  readonly current: number;
  readonly total?: number;
  readonly width?: number;
  readonly completeChar?: string;
  readonly incompleteChar?: string;
  readonly gradient?: boolean;
};

/** Builds a bounded bar without allocations proportional to terminal width beyond the requested bar size. */
export function renderProgressBar(options: ProgressBarRenderOptions): string {
  const total = Math.max(1, options.total ?? 100);
  const width = Math.max(1, options.width ?? 16);
  const completeChar = options.completeChar ?? "█";
  const incompleteChar = options.incompleteChar ?? "░";
  const ratio = Math.min(1, Math.max(0, options.current / total));
  const filled = Math.round(width * ratio);
  const empty = width - filled;

  if (options.gradient !== false && filled > 0) {
    let bar = "";
    for (let index = 0; index < filled; index += 1) {
      const t = filled > 1 ? index / (filled - 1) : ratio;
      bar += `${modernGradientColor(t)}${completeChar}`;
    }
    return `${bar}${RESET}${GRAY}${incompleteChar.repeat(empty)}${RESET}`;
  }

  return `${CYAN}${completeChar.repeat(filled)}${RESET}${GRAY}${incompleteChar.repeat(empty)}${RESET}`;
}

/** Adds a lightweight shimmer effect for active labels; spaces stay stable to avoid layout jitter. */
export function renderShimmerText(text: string, frame: number, sparkleChars: readonly string[] = ["✦", "✧", "⋆", "·"]): string {
  let output = "";
  let sparkleIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === " ") {
      output += character;
      continue;
    }
    const sparklePhase = Math.sin((frame * 0.3) + (index * 0.7)) * 0.5 + 0.5;
    if (sparklePhase > 0.85) {
      const sparkle = sparkleChars[sparkleIndex % sparkleChars.length] ?? "✦";
      sparkleIndex += 1;
      output += `${BRIGHT_YELLOW}${BOLD}${sparkle}${RESET}`;
    } else if (sparklePhase > 0.6) {
      output += `${BRIGHT_WHITE}${BOLD}${character}${RESET}`;
    } else {
      output += `${CYAN}${character}${RESET}`;
    }
  }
  return output;
}

/** Modern terminal text sweep: cyan → blue → green → amber. */
export function renderGradientText(text: string, phase: number = 0): string {
  let output = "";
  const chars = [...text];
  const denominator = Math.max(1, chars.length - 1);
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (char === " ") {
      output += char;
      continue;
    }
    const t = ((index / denominator) + phase) % 1;
    output += `${modernGradientColor(t)}${BOLD}${char}${RESET}`;
  }
  return output;
}

export function renderCliPanel(title: string, rows: readonly string[], width: number = 88): string {
  const safeWidth = Math.max(48, width);
  const contentWidth = safeWidth - 4;
  const titleText = renderGradientText(title);
  const titleWidth = visibleLength(titleText);
  return [
    `╭─ ${titleText}${DIM}${"─".repeat(Math.max(0, contentWidth - titleWidth - 2))}${RESET}╮`,
    ...rows.map((row) => framedPanelLine(row, contentWidth)),
    `╰${DIM}${"─".repeat(safeWidth - 2)}${RESET}╯`,
  ].join("\n");
}

export function renderCliSplash(model: string, cwd: string, approvalMode: string, width: number = 88): string {
  return renderCliPanel("Coding Agent", [
    `${renderGradientText("Five-tool coding workspace")} ${DIM}parallel search/read/bash · guarded write/update · resumable TUI${RESET}`,
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
  const rendered = metrics.map((metric) => renderMetricPill(metric)).join(" ");
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

function renderMetricPill(metric: StatusMetric): string {
  const color = toneColor(metric.tone ?? "idle");
  const label = `${DIM}${metric.label}${RESET}`;
  const value = `${color}${BOLD}${metric.value}${RESET}`;
  return `${DIM}╭─${RESET}${label} ${value}${DIM}─╮${RESET}`;
}

function modernGradientColor(t: number): string {
  const wrapped = ((t % 1) + 1) % 1;
  const stops: readonly [number, number, number][] = [
    [0, 220, 255],
    [90, 130, 255],
    [30, 190, 140],
    [255, 190, 70],
  ];
  const scaled = wrapped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = stops[index] ?? stops[0];
  const to = stops[index + 1] ?? stops[stops.length - 1];
  return rgb(
    Math.round(from[0] + (to[0] - from[0]) * local),
    Math.round(from[1] + (to[1] - from[1]) * local),
    Math.round(from[2] + (to[2] - from[2]) * local),
  );
}
function ansiEndIndex(text: string, start: number): number {
  const match = /\x1B\[[0-?]*[ -/]*[@-~]/.exec(text.slice(start));
  return match?.index === 0 ? start + match[0].length : start + 1;
}


function rgb(red: number, green: number, blue: number): string {
  return `${ESC}[38;2;${red};${green};${blue}m`;
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
      return BLUE;
  }
}
