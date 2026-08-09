const ESC = "\x1B";

const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;

export type StatusTone = "idle" | "busy" | "success" | "warn";

export function renderStatusBar(label: string, message: string, width: number, tone: StatusTone = "idle", progress?: number): string {
  const safeWidth = Math.max(20, width);
  const barWidth = Math.max(6, Math.min(18, Math.floor(safeWidth / 5)));
  const normalizedProgress = progress === undefined ? defaultProgress(tone) : Math.min(1, Math.max(0, progress));
  const filled = Math.round(barWidth * normalizedProgress);
  const color = toneColor(tone);
  const bar = `${color}${"█".repeat(filled)}${DIM}${"░".repeat(barWidth - filled)}${RESET}`;
  const prefix = `${color}${label}${RESET} ${bar}`;
  const available = Math.max(0, safeWidth - visibleLength(prefix) - 1);
  return `${prefix} ${clipAnsi(message, available)}`;
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
      return DIM;
  }
}
