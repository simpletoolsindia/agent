import { runAgentTUI, type TerminalPartDisplayMode } from "@ai-sdk/tui";
import { basename, resolve } from "node:path";
import type { ApprovalMode } from "../ai/ai-tools.js";
import type { OpenAICompatibleCodingAgentOptions } from "../ai/coding-agent.js";
import { createSlashCommandAgent } from "./slash-agent.js";

export type OpenAICompatibleAiTuiOptions = OpenAICompatibleCodingAgentOptions & {
  readonly contextSize?: number;
  readonly toolDisplay?: TerminalPartDisplayMode;
  readonly reasoningDisplay?: TerminalPartDisplayMode;
};

const DEFAULT_TOOL_DISPLAY: TerminalPartDisplayMode = "collapsed";
const DEFAULT_REASONING_DISPLAY: TerminalPartDisplayMode = "collapsed";

/** Starts the interactive terminal UI for the OpenAI-compatible coding AI. */
export async function runOpenAICompatibleAiTui(options: OpenAICompatibleAiTuiOptions): Promise<void> {
  const approvalMode = options.approvalMode ?? "safe";
  const agent = createSlashCommandAgent({
    ...options,
    loggerScope: "tui",
    loggerLevel: "warn",
  });

  await runAgentTUI({
    title: formatTuiTitle(options.cwd, options.model, approvalMode),
    agent,
    tools: options.toolDisplay ?? DEFAULT_TOOL_DISPLAY,
    reasoning: options.reasoningDisplay ?? DEFAULT_REASONING_DISPLAY,
    responseStatistics: "outputTokensPerSecond",
    contextSize: options.contextSize,
  });
}

function formatTuiTitle(cwd: string, model: string, approvalMode: ApprovalMode): string {
  const workspaceName = basename(resolve(cwd)) || resolve(cwd);
  return `Harness AI · ${workspaceName} · ${model} · ${approvalMode} · /settings · /compact`;
}
