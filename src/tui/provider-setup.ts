import type { ApprovalMode } from "../ai/ai-tools.js";
import type { OpenAICompatibleCodingAgentOptions } from "../ai/coding-agent.js";
import { clipAnsi, renderActivityPulse, renderGradientText, renderMetricStrip, renderProgressSteps, renderStatusBar, visibleLength } from "./status-bar.js";

const ESC = "\x1B";
const ENTER_ALT_SCREEN = `${ESC}[?1049h${ESC}[?25l`;
const EXIT_ALT_SCREEN = `${ESC}[?25h${ESC}[?1049l`;
const CLEAR_SCREEN = `${ESC}[H${ESC}[2J`;
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;
const CYAN = `${ESC}[36m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const BLUE = `${ESC}[34m`;
const ACCENT_BLUE = `${ESC}[94m`;
const CONTEXT_SIZE_PRESETS = ["", "32768", "65536", "128000"] as const;

const FIELDS = ["model", "contextSize", "baseURL", "apiKey", "approvalMode", "agentMdPath", "skillsMdPath"] as const;
const FIELD_LABELS: Record<ProviderSetupField, string> = {
  model: "Model name",
  contextSize: "Context tokens",
  baseURL: "Server URL",
  apiKey: "API key",
  approvalMode: "Approval mode",
  agentMdPath: "Agent.md path",
  skillsMdPath: "Skills.md path",
};
const FIELD_HELP: Record<ProviderSetupField, string> = {
  model: "Examples: gpt-4o-mini, qwen2.5-coder:7b, llama3.1:8b",
  contextSize: "Optional token limit override. Leave blank to auto-detect from model.",
  baseURL: "OpenAI-compatible /v1 endpoint. Leave blank for OpenAI default.",
  apiKey: "Stored only in memory for this run. Use ollama for local Ollama.",
  approvalMode: "safe asks before write/bash; auto runs approved tools without prompting.",
  agentMdPath: "Optional workspace markdown with project-specific agent instructions.",
  skillsMdPath: "Optional workspace markdown with reusable skill instructions.",
};

type ProviderSetupField = typeof FIELDS[number];

type ProviderSetupValues = {
  readonly model: string;
  readonly baseURL?: string;
  readonly apiKey?: string;
  readonly approvalMode?: ApprovalMode;
  readonly contextSize?: number;
  readonly agentMdPath?: string;
  readonly skillsMdPath?: string;
};

type MutableProviderSetupValues = {
  model: string;
  baseURL: string;
  apiKey: string;
  approvalMode: string;
  contextSize: string;
  agentMdPath: string;
  skillsMdPath: string;
};

type ProviderSetupState = {
  readonly activeField: number;
  readonly values: MutableProviderSetupValues;
  readonly message?: string;
  readonly frame?: number;
};

export type ProviderSetupMode = "auto" | "always" | "never";

export type ProviderSetupOptions = {
  readonly mode: ProviderSetupMode;
};

export async function maybeRunProviderSetup<T extends OpenAICompatibleCodingAgentOptions>(
  options: T,
  setup: ProviderSetupOptions,
): Promise<T> {
  if (setup.mode === "never" || !process.stdin.isTTY || !process.stdout.isTTY) {
    return options;
  }

  if (setup.mode === "auto" && options.apiKey !== undefined && options.model.trim().length > 0) {
    return options;
  }

  const values = await runProviderSetup({
    model: options.model,
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    agentMdPath: options.agentMdPath,
    skillsMdPath: options.skillsMdPath,
    contextSize: options.contextSize,
    approvalMode: options.approvalMode,
  });

  return resolveProviderSetupOptions(options, values);
}

export function resolveProviderSetupOptions<T extends OpenAICompatibleCodingAgentOptions>(
  options: T,
  values: ProviderSetupValues,
): T {
  return {
    ...options,
    model: values.model.trim().length === 0 ? options.model : values.model.trim(),
    baseURL: normalizedOptionalValue(values.baseURL),
    apiKey: normalizedOptionalValue(values.apiKey),
    approvalMode: normalizedApprovalMode(values.approvalMode, options.approvalMode),
    contextSize: normalizedPositiveInteger(values.contextSize, options.contextSize),
    agentMdPath: normalizedOptionalValue(values.agentMdPath),
    skillsMdPath: normalizedOptionalValue(values.skillsMdPath),
  };
}

export async function runProviderSetup(initial: ProviderSetupValues): Promise<ProviderSetupValues> {
  const input = process.stdin;
  const output = process.stdout;
  const originalRawMode = input.isRaw;
  const state: ProviderSetupState = {
    activeField: 0,
    values: {
      model: initial.model,
      baseURL: initial.baseURL ?? "",
      apiKey: initial.apiKey ?? "",
      approvalMode: initial.approvalMode ?? "safe",
      contextSize: initial.contextSize?.toString() ?? "",
      agentMdPath: initial.agentMdPath ?? "",
      skillsMdPath: initial.skillsMdPath ?? "",
    },
    message: "Fill provider settings, then press Ctrl+S to start.",
    frame: 0,
  };
  let current = state;
  const { promise, resolve, reject } = Promise.withResolvers<ProviderSetupValues>();

  output.write(ENTER_ALT_SCREEN);
  if (input.isTTY) {
    input.setRawMode(true);
    input.resume();
  }

  const repaint = () => output.write(`${CLEAR_SCREEN}${renderProviderSetupScreen(current, output.columns ?? 88)}`);
  const animation = setInterval(() => {
    current = { ...current, frame: (current.frame ?? 0) + 1 };
    repaint();
  }, 180);
  animation.unref?.();
  const cleanup = () => {
    clearInterval(animation);
    input.off("data", onData);
    if (input.isTTY) {
      input.setRawMode(originalRawMode);
      if (!originalRawMode) {
        input.pause();
      }
    }
    output.write(EXIT_ALT_SCREEN);
  };

  const onData = (chunk: Buffer) => {
    try {
      const next = reduceProviderSetupInput(current, chunk.toString("utf8"));
      if (next.type === "submit") {
        cleanup();
        resolve(toProviderSetupValues(current.values));
        return;
      }
      if (next.type === "cancel") {
        cleanup();
        reject(new Error("Provider setup cancelled"));
        return;
      }
      current = next.state;
      repaint();
    } catch (error) {
      cleanup();
      reject(error);
    }
  };

  input.on("data", onData);
  repaint();
  return await promise;
}

export function reduceProviderSetupInput(state: ProviderSetupState, key: string):
  | { readonly type: "state"; readonly state: ProviderSetupState }
  | { readonly type: "submit" }
  | { readonly type: "cancel" } {
  if (key === "\u0003" || key === ESC) {
    return { type: "cancel" };
  }
  if (key === "\u0013") {
    return validateProviderSetup(state);
  }
  if (key === "\u000F") {
    return {
      type: "state",
      state: {
        ...state,
        values: {
          ...state.values,
          model: state.values.model.trim().length === 0 || state.values.model === "gpt-4o-mini" ? "qwen2.5-coder:7b" : state.values.model,
          baseURL: "http://localhost:11434/v1",
          apiKey: "ollama",
        },
        message: "Ollama preset applied. Press Ctrl+A for auto approval or Ctrl+S to start.",
      },
    };
  }
  if (key === "\u0004") {
    return {
      type: "state",
      state: {
        ...state,
        values: { ...state.values, baseURL: "", apiKey: "" },
        message: "OpenAI default endpoint selected. Add an API key if needed.",
      },
    };
  }
  if (key === "\u0001") {
    return {
      type: "state",
      state: {
        ...state,
        values: { ...state.values, approvalMode: state.values.approvalMode === "auto" ? "safe" : "auto" },
        message: state.values.approvalMode === "auto" ? "Safe approval enabled." : "Auto approval enabled for this session.",
      },
    };
  }
  if (key === "\u0018") {
    const nextContextSize = nextContextSizePreset(state.values.contextSize);
    return {
      type: "state",
      state: {
        ...state,
        values: { ...state.values, contextSize: nextContextSize },
        message: nextContextSize.length === 0 ? "Context tokens set to auto-detect." : `Context tokens set to ${Number(nextContextSize).toLocaleString()}.`,
      },
    };
  }
  if (key === "\u0015") {
    const field = FIELDS[state.activeField];
    return {
      type: "state",
      state: {
        ...state,
        values: { ...state.values, [field]: "" },
        message: `${FIELD_LABELS[field]} cleared.`,
      },
    };
  }
  if ((FIELDS[state.activeField] === "approvalMode" || FIELDS[state.activeField] === "contextSize") && (key === " " || key === "\x1B[C" || key === "\x1B[D")) {
    const field = FIELDS[state.activeField];
    if (field === "contextSize") {
      const nextContextSize = nextContextSizePreset(state.values.contextSize);
      return {
        type: "state",
        state: {
          ...state,
          values: { ...state.values, contextSize: nextContextSize },
          message: nextContextSize.length === 0 ? "Context tokens set to auto-detect." : `Context tokens set to ${Number(nextContextSize).toLocaleString()}.`,
        },
      };
    }
    const nextApproval = normalizedApprovalMode(state.values.approvalMode, "safe") === "auto" ? "safe" : "auto";
    return {
      type: "state",
      state: {
        ...state,
        values: { ...state.values, approvalMode: nextApproval },
        message: `Approval mode set to ${nextApproval}.`,
      },
    };
  }
  if (key === "\t" || key === "\x1B[B") {
    return {
      type: "state",
      state: { ...state, activeField: (state.activeField + 1) % FIELDS.length, message: undefined },
    };
  }
  if (key === "\x1B[A") {
    return {
      type: "state",
      state: { ...state, activeField: (state.activeField + FIELDS.length - 1) % FIELDS.length, message: undefined },
    };
  }
  if (key === "\r" || key === "\n") {
    if (state.activeField === FIELDS.length - 1) {
      return validateProviderSetup(state);
    }
    return {
      type: "state",
      state: { ...state, activeField: state.activeField + 1, message: undefined },
    };
  }
  if (key === "\x7F" || key === "\b") {
    const field = FIELDS[state.activeField];
    return {
      type: "state",
      state: {
        ...state,
        values: { ...state.values, [field]: state.values[field].slice(0, -1) },
        message: undefined,
      },
    };
  }
  if (key.length > 0 && key >= " " && key !== "\x7F") {
    const field = FIELDS[state.activeField];
    if (field === "approvalMode") {
      const nextApproval = key.toLowerCase() === "a" ? "auto" : key.toLowerCase() === "s" ? "safe" : undefined;
      return nextApproval === undefined
        ? { type: "state", state: { ...state, message: "Use Space/←/→ to choose safe or auto." } }
        : { type: "state", state: { ...state, values: { ...state.values, approvalMode: nextApproval }, message: `Approval mode set to ${nextApproval}.` } };
    }
    if (field === "contextSize" && key === " ") {
      const nextContextSize = nextContextSizePreset(state.values.contextSize);
      return { type: "state", state: { ...state, values: { ...state.values, contextSize: nextContextSize }, message: nextContextSize.length === 0 ? "Context tokens set to auto-detect." : `Context tokens set to ${Number(nextContextSize).toLocaleString()}.` } };
    }
    return {
      type: "state",
      state: {
        ...state,
        values: { ...state.values, [field]: `${state.values[field]}${key}` },
        message: undefined,
      },
    };
  }
  return { type: "state", state };
}

export function renderProviderSetupScreen(state: ProviderSetupState, width: number): string {
  const safeWidth = Math.max(72, width);
  const contentWidth = safeWidth - 4;
  const frame = state.frame ?? 0;
  const approval = normalizedApprovalMode(state.values.approvalMode, "safe") ?? "safe";
  const connectionState = state.values.baseURL.trim().length === 0 ? "OpenAI default" : "custom /v1";
  const docsState = [state.values.agentMdPath, state.values.skillsMdPath].filter((value) => value.trim().length > 0).length;
  const contextState = normalizedPositiveInteger(state.values.contextSize, undefined)?.toLocaleString() ?? "auto";
  const rows = [
    topBorder(safeWidth, ` ${renderGradientText("Coding Agent setup", frame / 24)} `),
    framedLine(`${renderGradientText("Modern five-tool workspace", frame / 30)} ${DIM}rounded cards · profile chips · stage rail · live validation${RESET}`, contentWidth),
    framedLine(renderMetricStrip([
      { label: "model", value: state.values.model.trim().length === 0 ? "unset" : state.values.model.trim(), tone: "busy" },
      { label: "ctx", value: contextState, tone: contextState === "auto" ? "idle" : "success" },
      { label: "endpoint", value: connectionState, tone: connectionState === "custom /v1" ? "success" : "idle" },
      { label: "approval", value: approval, tone: approval === "auto" ? "success" : "warn" },
      { label: "docs", value: `${docsState}/2`, tone: docsState === 0 ? "idle" : "success" },
    ], contentWidth), contentWidth),
    framedLine(renderProgressSteps(FIELDS.map((field) => FIELD_LABELS[field]), state.activeField, contentWidth), contentWidth),
    framedLine(renderActivityPulse("Setup", "Keyboard-first setup with animated state, shortcuts, and compact cards.", contentWidth, frame, "busy"), contentWidth),
    framedLine("", contentWidth),
    renderSectionTitle("Profile cards", contentWidth),
    ...FIELDS.slice(0, 5).flatMap((field, index) => renderFieldRows(state, field, index, contentWidth, frame)),
    renderSectionTitle("Workspace context", contentWidth),
    ...FIELDS.slice(5).flatMap((field, offset) => renderFieldRows(state, field, offset + 5, contentWidth, frame)),
    framedLine("", contentWidth),
    renderSectionTitle("Command deck", contentWidth),
    framedLine(renderShortcutRow(["Tab/↓ next", "↑ previous", "Enter next/start", "Ctrl+S start"], contentWidth), contentWidth),
    framedLine(renderShortcutRow(["Ctrl+O Ollama", "Ctrl+X ctx size", "Ctrl+A approval", "Ctrl+D OpenAI", "Ctrl+U clear"], contentWidth), contentWidth),
    framedLine(renderShortcutRow(["Space/←/→ dropdown", "Esc cancel"], contentWidth), contentWidth),
    framedLine("", contentWidth),
    framedLine(renderStatusBar("Status", state.message ?? "Ready. Use Ctrl+X for context size or Space on dropdown fields.", contentWidth, state.message === undefined ? "idle" : "busy", (state.activeField + 1) / FIELDS.length), contentWidth),
    bottomBorder(safeWidth),
  ];
  return rows.join("\n");
}

function validateProviderSetup(state: ProviderSetupState):
  | { readonly type: "state"; readonly state: ProviderSetupState }
  | { readonly type: "submit" } {
  if (state.values.model.trim().length === 0) {
    return {
      type: "state",
      state: { ...state, activeField: 0, message: "Model name is required." },
    };
  }
  const approval = normalizedApprovalMode(state.values.approvalMode, undefined);
  if (approval === undefined) {
    return {
      type: "state",
      state: { ...state, activeField: FIELDS.indexOf("approvalMode"), message: "Approval mode must be safe or auto." },
    };
  }
  if (state.values.contextSize.trim().length > 0 && normalizedPositiveInteger(state.values.contextSize, undefined) === undefined) {
    return {
      type: "state",
      state: { ...state, activeField: FIELDS.indexOf("contextSize"), message: "Context tokens must be a positive integer or blank for auto." },
    };
  }
  return { type: "submit" };
}

function renderFieldRows(state: ProviderSetupState, field: ProviderSetupField, index: number, width: number, frame: number): string[] {
  const active = state.activeField === index;
  const marker = active ? activeMarker(frame) : `${DIM}◇${RESET}`;
  const rawValue = state.values[field];
  const visibleValue = visibleFieldValue(field, rawValue, active);
  const value = visibleValue.length === 0 ? `${DIM}<empty>${RESET}` : active ? `${CYAN}${visibleValue}${RESET}` : visibleValue;
  const indexText = `${DIM}${index + 1}/${FIELDS.length}${RESET}`;
  return [
    framedLine(`${marker} ${indexText} ${BOLD}${FIELD_LABELS[field].padEnd(15)}${RESET} ${value}`, width),
    framedLine(`    ${DIM}${FIELD_HELP[field]}${RESET}`, width),
  ];
}

function visibleFieldValue(field: ProviderSetupField, rawValue: string, active: boolean): string {
  if (field === "apiKey" && rawValue.length > 0) {
    return "•".repeat(Math.min(rawValue.length, 32));
  }
  if (field === "approvalMode") {
    const current = normalizedApprovalMode(rawValue, "safe") ?? "safe";
    const safe = current === "safe" ? `${BOLD}safe${RESET}` : "safe";
    const auto = current === "auto" ? `${BOLD}auto${RESET}` : "auto";
    return active ? `▾ ${safe} / ${auto}` : current;
  }
  if (field === "contextSize") {
    return active ? renderContextSizeChoices(rawValue) : rawValue;
  }
  return rawValue;
}

function renderContextSizeChoices(rawValue: string): string {
  const normalized = normalizedPositiveInteger(rawValue, undefined)?.toString() ?? "";
  const current = CONTEXT_SIZE_PRESETS.some((value) => value === normalized) ? normalized : rawValue.trim();
  const choices = CONTEXT_SIZE_PRESETS.map((value) => {
    const label = value.length === 0 ? "auto" : `${Math.round(Number(value) / 1024)}k`;
    return value === current ? `${BOLD}${label}${RESET}` : label;
  }).join(" / ");
  return current.length > 0 && !CONTEXT_SIZE_PRESETS.some((value) => value === current)
    ? `▾ custom ${current} / ${choices}`
    : `▾ ${choices}`;
}

function nextContextSizePreset(current: string): string {
  const normalized = normalizedPositiveInteger(current, undefined)?.toString() ?? "";
  const currentIndex = CONTEXT_SIZE_PRESETS.findIndex((value) => value === normalized);
  return CONTEXT_SIZE_PRESETS[(currentIndex + 1) % CONTEXT_SIZE_PRESETS.length] ?? "";
}

function toProviderSetupValues(values: MutableProviderSetupValues): ProviderSetupValues {
  return {
    model: values.model.trim(),
    baseURL: normalizedOptionalValue(values.baseURL),
    apiKey: normalizedOptionalValue(values.apiKey),
    approvalMode: normalizedApprovalMode(values.approvalMode, "safe") ?? "safe",
    contextSize: normalizedPositiveInteger(values.contextSize, undefined),
    agentMdPath: normalizedOptionalValue(values.agentMdPath),
    skillsMdPath: normalizedOptionalValue(values.skillsMdPath),
  };
}

function normalizedOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0 || trimmed.toLowerCase() === "none") {
    return undefined;
  }
  return trimmed;
}

function normalizedApprovalMode(value: string | undefined, fallback: ApprovalMode | undefined): ApprovalMode | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (trimmed === undefined || trimmed.length === 0 || trimmed === "none") {
    return fallback;
  }
  if (trimmed === "safe" || trimmed === "auto") {
    return trimmed;
  }
  return undefined;
}

function normalizedPositiveInteger(value: string | number | undefined, fallback: number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0 || trimmed.toLowerCase() === "none" || trimmed.toLowerCase() === "auto") {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed.toString() === trimmed ? parsed : undefined;
}

function topBorder(width: number, title: string): string {
  const remaining = Math.max(0, width - 2 - visibleLength(title));
  return `╭${title}${DIM}${"─".repeat(remaining)}${RESET}╮`;
}

function bottomBorder(width: number): string {
  return `╰${"─".repeat(width - 2)}╯`;
}

function framedLine(text: string, width: number): string {
  const clipped = clipAnsi(text, width);
  const padding = " ".repeat(Math.max(0, width - visibleLength(clipped)));
  return `│ ${clipped}${padding} │`;
}

function activeMarker(frame: number): string {
  return frame % 2 === 0 ? `${GREEN}◆${RESET}` : `${ACCENT_BLUE}◆${RESET}`;
}

function renderSectionTitle(title: string, width: number): string {
  const label = ` ${BLUE}${BOLD}${title}${RESET} `;
  const remaining = Math.max(0, width - visibleLength(label));
  return framedLine(`${label}${DIM}${"─".repeat(remaining)}${RESET}`, width);
}

function renderPill(label: string, value: string): string {
  return `${DIM}${label}${RESET} ${ACCENT_BLUE}${BOLD}${value}${RESET}`;
}

function renderShortcutRow(shortcuts: readonly string[], width: number): string {
  const rendered = shortcuts.map((shortcut) => `${CYAN}${shortcut}${RESET}`).join(`${DIM}  │  ${RESET}`);
  return clipAnsi(rendered, width);
}
