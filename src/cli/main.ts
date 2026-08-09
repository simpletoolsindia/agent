#!/usr/bin/env node
import { Command } from "commander";
import type { ApprovalMode } from "../ai/ai-tools.js";
import { runOpenAICompatibleAi } from "../ai/openai-compatible-ai.js";
import { runOpenAICompatibleAiTui } from "../tui/ai-tui.js";
import { renderActivityPulse, renderCliPanel, renderCliSplash } from "../tui/status-bar.js";
import { formatSessionList, listSessions } from "../tui/session-store.js";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const DEFAULT_PROVIDER_NAME = "openai-compatible";
const DEFAULT_APPROVAL_MODE: ApprovalMode = "safe";
const DEFAULT_TUI_CONTEXT_SIZE = "32768";
const DEFAULT_UI_DENSITY = "compact";
const APPROVAL_MODE_VALUES = ["safe", "auto"] as const;
const PART_DISPLAY_MODES = ["full", "collapsed", "auto-collapsed", "hidden"] as const;
const UI_DENSITY_VALUES = ["compact", "normal", "debug"] as const;
const CLI_SUGGESTIONS = [
  "Use `search` before reading unknown code.",
  "Use line ranges with `read` to keep prompts tight.",
  "Use `update` for hash-guarded edits.",
  "Use `harness tui` for approvals and live tool cards.",
] as const;

type TerminalPartDisplayMode = typeof PART_DISPLAY_MODES[number];
type UiDensity = typeof UI_DENSITY_VALUES[number];

type SharedAgentCommandOptions = {
  readonly cwd: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly providerName?: string;
  readonly approvalMode: string;
  readonly agentMd?: string;
  readonly skillsMd?: string;
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
  readonly setup?: boolean;
  readonly resume?: boolean | string;
  readonly sessionId?: string;
};

const UI_DENSITY_PRESETS: Record<UiDensity, {
  readonly toolDisplay: TerminalPartDisplayMode;
  readonly reasoningDisplay: TerminalPartDisplayMode;
}> = {
  compact: {
    toolDisplay: "collapsed",
    reasoningDisplay: "full",
  },
  normal: {
    toolDisplay: "auto-collapsed",
    reasoningDisplay: "full",
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
  const runtimeOptions = toRuntimeOptions(options);
  if (process.stdout.isTTY) {
    process.stdout.write(`${renderCliSplash(runtimeOptions.model, runtimeOptions.cwd, runtimeOptions.approvalMode, process.stdout.columns ?? 88)}\n\n`);
  }

  const result = await runWithCliAnimation(process.stdout.isTTY === true, async () => await runOpenAICompatibleAi({
    ...runtimeOptions,
    prompt: options.prompt,
  }));

  process.stdout.write(`${result.text}\n`);
  if (process.stdout.isTTY) {
    process.stdout.write(`\n${renderCliPanel("Run complete", [
      "Agent response finished. Use `harness tui` for approvals, live tools, and animated progress.",
      "Next shortcuts: `--auto-approve`, `--agent-md AGENT.md`, `--skills-md SKILLS.md`.",
    ], process.stdout.columns ?? 88)}\n`);
  }
});

program.command("sessions")
  .description("List the five saved resumable TUI sessions")
  .action(async () => {
    process.stdout.write(`${formatSessionList(await listSessions())}\n`);
  });

addTuiOptions(
  addSharedAgentOptions(
    program.command("tui")
      .description("Open the interactive terminal UI with /settings, /compact, and /agents commands"),
  ),
).action(async (options: TuiCommandOptions) => {
  const display = resolveTuiDisplay(options);
  await runOpenAICompatibleAiTui({
    ...toRuntimeOptions(options),
    contextSize: parseOptionalPositiveInteger(options.contextSize, "--context-size"),
    toolDisplay: display.toolDisplay,
    reasoningDisplay: display.reasoningDisplay,
    providerSetupMode: options.setup === false ? "never" : options.setup === true ? "always" : "auto",
    resumeSession: options.resume !== false,
    resumeSessionId: typeof options.resume === "string" ? options.resume : undefined,
    sessionId: options.sessionId,
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
    .option("--approval-mode <mode>", `approval mode: ${APPROVAL_MODE_VALUES.join("|")}`, DEFAULT_APPROVAL_MODE)
    .option("--agent-md <path>", "load extra agent instructions from a workspace markdown file")
    .option("--skills-md <path>", "load extra skill instructions from a workspace markdown file")
    .option("--auto-approve", "shortcut for --approval-mode auto");
}

function addTuiOptions(command: Command): Command {
  const displayModes = PART_DISPLAY_MODES.join("|");
  return command
    .option("--context-size <tokens>", "show context usage percentage in the TUI title", DEFAULT_TUI_CONTEXT_SIZE)
    .option("--ui-density <mode>", `UI preset: ${UI_DENSITY_VALUES.join("|")}`, DEFAULT_UI_DENSITY)
    .option("--tool-display <mode>", `override tool display: ${displayModes}`)
    .option("--reasoning-display <mode>", `override reasoning display: ${displayModes}`)
    .option("--setup", "open the rich provider setup UI before the TUI")
    .option("--no-setup", "skip the provider setup UI")
    .option("--resume [id]", "resume the latest saved session or a specific session id", true)
    .option("--no-resume", "start without loading a saved session")
    .option("--session-id <id>", "stable id to use when saving this TUI session");
}

function toRuntimeOptions(options: SharedAgentCommandOptions) {
  return {
    cwd: options.cwd,
    model: options.model,
    baseURL: options.baseUrl,
    apiKey: options.apiKey,
    providerName: options.providerName,
    agentMdPath: options.agentMd,
    skillsMdPath: options.skillsMd,
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

async function runWithCliAnimation<T>(enabled: boolean, action: () => Promise<T>): Promise<T> {
  if (!enabled) {
    return await action();
  }

  let frame = 0;
  const writeFrame = () => {
    const message = CLI_SUGGESTIONS[frame % CLI_SUGGESTIONS.length];
    process.stdout.write(`\r\x1B[2K${renderActivityPulse("AI running", message, process.stdout.columns ?? 88, frame, "busy")}`);
    frame += 1;
  };

  writeFrame();
  const timer = setInterval(writeFrame, 180);
  timer.unref?.();
  try {
    return await action();
  } finally {
    clearInterval(timer);
    process.stdout.write("\r\x1B[2K");
  }
}
