import type { OpenAICompatibleCodingAgentOptions } from "../ai/coding-agent.js";

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

const FIELDS = ["model", "baseURL", "apiKey"] as const;
const FIELD_LABELS: Record<ProviderSetupField, string> = {
  model: "Model name",
  baseURL: "Server URL",
  apiKey: "API key",
};
const FIELD_HELP: Record<ProviderSetupField, string> = {
  model: "Examples: gpt-4o-mini, qwen2.5-coder:7b, llama3.1:8b",
  baseURL: "OpenAI-compatible /v1 endpoint. Leave blank for OpenAI default.",
  apiKey: "Stored only in memory for this run. Use ollama for local Ollama.",
};

type ProviderSetupField = typeof FIELDS[number];

type ProviderSetupValues = {
  readonly model: string;
  readonly baseURL?: string;
  readonly apiKey?: string;
};

type MutableProviderSetupValues = {
  model: string;
  baseURL: string;
  apiKey: string;
};

type ProviderSetupState = {
  readonly activeField: number;
  readonly values: MutableProviderSetupValues;
  readonly message?: string;
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
    },
    message: "Fill provider settings, then press Ctrl+S to start.",
  };
  let current = state;
  const { promise, resolve, reject } = Promise.withResolvers<ProviderSetupValues>();

  output.write(ENTER_ALT_SCREEN);
  if (input.isTTY) {
    input.setRawMode(true);
    input.resume();
  }

  const repaint = () => output.write(`${CLEAR_SCREEN}${renderProviderSetupScreen(current, output.columns ?? 88)}`);
  const cleanup = () => {
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
          model: state.values.model.trim().length === 0 || state.values.model === "gpt-4o-mini" ? "qwen2.5-coder:7b" : state.values.model,
          baseURL: "http://localhost:11434/v1",
          apiKey: "ollama",
        },
        message: "Ollama preset applied. Press Ctrl+S to start.",
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
  const safeWidth = Math.max(64, width);
  const contentWidth = safeWidth - 4;
  const rows = [
    topBorder(safeWidth, " Provider setup "),
    framedLine(`${BOLD}Connect your OpenAI-compatible server${RESET}`, contentWidth),
    framedLine(`${DIM}Edit fields directly. This stays in memory for the current TUI session.${RESET}`, contentWidth),
    framedLine("", contentWidth),
    ...FIELDS.flatMap((field, index) => renderFieldRows(state, field, index, contentWidth)),
    framedLine("", contentWidth),
    framedLine(`${CYAN}Tab/↓${RESET} next  ${CYAN}↑${RESET} previous  ${CYAN}Enter${RESET} next/start  ${CYAN}Ctrl+S${RESET} start`, contentWidth),
    framedLine(`${CYAN}Ctrl+O${RESET} Ollama preset  ${CYAN}Ctrl+D${RESET} OpenAI default  ${CYAN}Ctrl+U${RESET} clear field  ${CYAN}Esc${RESET} cancel`, contentWidth),
    framedLine("", contentWidth),
    framedLine(state.message === undefined ? "" : `${YELLOW}${state.message}${RESET}`, contentWidth),
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
  return { type: "submit" };
}

function renderFieldRows(state: ProviderSetupState, field: ProviderSetupField, index: number, width: number): string[] {
  const active = state.activeField === index;
  const marker = active ? `${GREEN}●${RESET}` : " ";
  const rawValue = state.values[field];
  const visibleValue = field === "apiKey" && rawValue.length > 0 ? "•".repeat(Math.min(rawValue.length, 32)) : rawValue;
  const label = `${marker} ${BOLD}${FIELD_LABELS[field]}${RESET}`;
  const value = visibleValue.length === 0 ? `${DIM}<empty>${RESET}` : visibleValue;
  return [
    framedLine(label, width),
    framedLine(`  ${active ? `${CYAN}>${RESET}` : " "} ${value}`, width),
    framedLine(`    ${DIM}${FIELD_HELP[field]}${RESET}`, width),
  ];
}

function toProviderSetupValues(values: MutableProviderSetupValues): ProviderSetupValues {
  return {
    model: values.model.trim(),
    baseURL: normalizedOptionalValue(values.baseURL),
    apiKey: normalizedOptionalValue(values.apiKey),
  };
}

function normalizedOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0 || trimmed.toLowerCase() === "none") {
    return undefined;
  }
  return trimmed;
}

function topBorder(width: number, title: string): string {
  const remaining = Math.max(0, width - 2 - title.length);
  return `╭${title}${"─".repeat(remaining)}╮`;
}

function bottomBorder(width: number): string {
  return `╰${"─".repeat(width - 2)}╯`;
}

function framedLine(text: string, width: number): string {
  const visible = stripAnsi(text);
  const clipped = visible.length > width ? text.slice(0, Math.max(0, width - 1)) : text;
  const padding = " ".repeat(Math.max(0, width - stripAnsi(clipped).length));
  return `│ ${clipped}${padding} │`;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}
