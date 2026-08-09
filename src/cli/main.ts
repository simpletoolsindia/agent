#!/usr/bin/env node
import { Command } from "commander";
import type { ApprovalMode } from "../ai/ai-tools.js";
import { runOpenAICompatibleAi } from "../ai/openai-compatible-ai.js";
import { runOpenAICompatibleAiTui } from "../tui/ai-tui.js";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const DEFAULT_PROVIDER_NAME = "openai-compatible";
const DEFAULT_MAX_STEPS = "20";
const DEFAULT_APPROVAL_MODE: ApprovalMode = "safe";
const DEFAULT_TUI_CONTEXT_SIZE = "32768";
const DEFAULT_UI_DENSITY = "compact";
const APPROVAL_MODE_VALUES = ["safe", "auto"] as const;
const PART_DISPLAY_MODES = ["full", "collapsed", "auto-collapsed", "hidden"] as const;
const UI_DENSITY_VALUES = ["compact", "normal", "debug"] as const;

type TerminalPartDisplayMode = typeof PART_DISPLAY_MODES[number];
type UiDensity = typeof UI_DENSITY_VALUES[number];

type SharedAgentCommandOptions = {
  readonly cwd: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly providerName?: string;
  readonly maxSteps: string;
  readonly approvalMode: string;
  readonly autoApprove?: boolean;
};

type OneShotAgentCommandOptions = SharedAgentCommandOptions & {
  readonly prompt: string;
};

type TuiCommandOptions = SharedAgentCommandOptions & {
  readonly contextSize?: string;
  readonly uiDensity: string;
  readonly toolDisplay?: string;
  readonly reasoningDisplay?: string;
};

const UI_DENSITY_PRESETS: Record<UiDensity, {
  readonly toolDisplay: TerminalPartDisplayMode;
  readonly reasoningDisplay: TerminalPartDisplayMode;
}> = {
  compact: {
    toolDisplay: "collapsed",
    reasoningDisplay: "collapsed",
  },
  normal: {
    toolDisplay: "auto-collapsed",
    reasoningDisplay: "collapsed",
  },
  debug: {
    toolDisplay: "full",
    reasoningDisplay: "full",
  },
};

const program = new Command();

program
  .name("harness")
  .description("Five-tool coding harness prototype")
  .version("0.1.0");

addSharedAgentOptions(
  program.command("ai")
    .description("Run one OpenAI-compatible LLM request")
    .requiredOption("-p, --prompt <prompt>", "user prompt to send to the AI"),
).action(async (options: OneShotAgentCommandOptions) => {
  const result = await runOpenAICompatibleAi({
    ...toRuntimeOptions(options),
    prompt: options.prompt,
  });

  process.stdout.write(`${result.text}\n`);
});

addTuiOptions(
  addSharedAgentOptions(
    program.command("tui")
      .description("Open the interactive terminal UI with /settings and /compact commands"),
  ),
).action(async (options: TuiCommandOptions) => {
  const display = resolveTuiDisplay(options);
  await runOpenAICompatibleAiTui({
    ...toRuntimeOptions(options),
    contextSize: parseOptionalPositiveInteger(options.contextSize, "--context-size"),
    toolDisplay: display.toolDisplay,
    reasoningDisplay: display.reasoningDisplay,
  });
});

await program.parseAsync();

function addSharedAgentOptions(command: Command): Command {
  return command
    .option("--cwd <path>", "workspace root", process.cwd())
    .option("--model <model>", "model id", DEFAULT_MODEL)
    .option("--base-url <url>", "OpenAI-compatible API base URL", process.env.OPENAI_BASE_URL)
    .option("--api-key <key>", "API key", process.env.OPENAI_API_KEY)
    .option("--provider-name <name>", "provider name for logs", DEFAULT_PROVIDER_NAME)
    .option("--max-steps <count>", "maximum tool loop steps", DEFAULT_MAX_STEPS)
    .option("--approval-mode <mode>", `approval mode: ${APPROVAL_MODE_VALUES.join("|")}`, DEFAULT_APPROVAL_MODE)
    .option("--auto-approve", "shortcut for --approval-mode auto");
}

function addTuiOptions(command: Command): Command {
  const displayModes = PART_DISPLAY_MODES.join("|");
  return command
    .option("--context-size <tokens>", "show context usage percentage in the TUI title", DEFAULT_TUI_CONTEXT_SIZE)
    .option("--ui-density <mode>", `UI preset: ${UI_DENSITY_VALUES.join("|")}`, DEFAULT_UI_DENSITY)
    .option("--tool-display <mode>", `override tool display: ${displayModes}`)
    .option("--reasoning-display <mode>", `override reasoning display: ${displayModes}`);
}

function toRuntimeOptions(options: SharedAgentCommandOptions) {
  return {
    cwd: options.cwd,
    model: options.model,
    baseURL: options.baseUrl,
    apiKey: options.apiKey,
    providerName: options.providerName,
    maxSteps: parseMaxSteps(options.maxSteps),
    approvalMode: options.autoApprove === true ? "auto" as const : parseApprovalMode(options.approvalMode),
  };
}

function resolveTuiDisplay(options: TuiCommandOptions): {
  readonly toolDisplay: TerminalPartDisplayMode;
  readonly reasoningDisplay: TerminalPartDisplayMode;
} {
  const density = parseUiDensity(options.uiDensity);
  const preset = UI_DENSITY_PRESETS[density];

  return {
    toolDisplay: options.toolDisplay === undefined
      ? preset.toolDisplay
      : parsePartDisplayMode(options.toolDisplay, "--tool-display"),
    reasoningDisplay: options.reasoningDisplay === undefined
      ? preset.reasoningDisplay
      : parsePartDisplayMode(options.reasoningDisplay, "--reasoning-display"),
  };
}

function parseMaxSteps(value: string): number {
  return parsePositiveInteger(value, "--max-steps");
}

function parseOptionalPositiveInteger(value: string | undefined, optionName: string): number | undefined {
  return value === undefined ? undefined : parsePositiveInteger(value, optionName);
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer, received: ${value}`);
  }

  return parsed;
}

function parseApprovalMode(value: string): ApprovalMode {
  if (isApprovalMode(value)) {
    return value;
  }

  throw new Error(`--approval-mode must be one of: ${APPROVAL_MODE_VALUES.join(", ")}`);
}

function isApprovalMode(value: string): value is ApprovalMode {
  return APPROVAL_MODE_VALUES.some((mode) => mode === value);
}

function parseUiDensity(value: string): UiDensity {
  if (isUiDensity(value)) {
    return value;
  }

  throw new Error(`--ui-density must be one of: ${UI_DENSITY_VALUES.join(", ")}`);
}

function isUiDensity(value: string): value is UiDensity {
  return UI_DENSITY_VALUES.some((density) => density === value);
}

function parsePartDisplayMode(value: string, optionName: string): TerminalPartDisplayMode {
  if (isPartDisplayMode(value)) {
    return value;
  }

  throw new Error(`${optionName} must be one of: ${PART_DISPLAY_MODES.join(", ")}`);
}

function isPartDisplayMode(value: string): value is TerminalPartDisplayMode {
  return PART_DISPLAY_MODES.some((mode) => mode === value);
}
