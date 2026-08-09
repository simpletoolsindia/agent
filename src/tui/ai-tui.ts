import { runAgentTUI, type TerminalPartDisplayMode } from "@ai-sdk/tui";
import { basename, resolve } from "node:path";
import type { ApprovalMode } from "../ai/ai-tools.js";
import type { OpenAICompatibleCodingAgentOptions } from "../ai/coding-agent.js";
import { createSlashCommandAgent } from "./slash-agent.js";
import { maybeRunProviderSetup, type ProviderSetupMode } from "./provider-setup.js";

export type OpenAICompatibleAiTuiOptions = OpenAICompatibleCodingAgentOptions & {
  readonly contextSize?: number;
  readonly toolDisplay?: TerminalPartDisplayMode;
  readonly reasoningDisplay?: TerminalPartDisplayMode;
  readonly providerSetupMode?: ProviderSetupMode;
};

const DEFAULT_TOOL_DISPLAY: TerminalPartDisplayMode = "collapsed";
const DEFAULT_REASONING_DISPLAY: TerminalPartDisplayMode = "collapsed";

/** Starts the interactive terminal UI for the OpenAI-compatible coding AI. */
export async function runOpenAICompatibleAiTui(options: OpenAICompatibleAiTuiOptions): Promise<void> {
  const configuredOptions = await maybeRunProviderSetup(options, {
    mode: options.providerSetupMode ?? "auto",
  });
  const approvalMode = configuredOptions.approvalMode ?? "safe";
  const agent = createSlashCommandAgent({
    ...configuredOptions,
    loggerScope: "tui",
    loggerLevel: "warn",
  });

  await runAgentTUI({
    title: formatTuiTitle(configuredOptions.cwd, configuredOptions.model, approvalMode),
    agent,
    tools: configuredOptions.toolDisplay ?? DEFAULT_TOOL_DISPLAY,
    reasoning: configuredOptions.reasoningDisplay ?? DEFAULT_REASONING_DISPLAY,
    responseStatistics: "outputTokensPerSecond",
    contextSize: configuredOptions.contextSize,
  });
}

function formatTuiTitle(cwd: string, model: string, approvalMode: ApprovalMode): string {
  const workspaceName = basename(resolve(cwd)) || resolve(cwd);
  return `Harness AI · ${workspaceName} · ${model} · ${approvalMode} · /settings · /compact · /agents`;
}
