import type { TerminalPartDisplayMode } from "@ai-sdk/tui";
import { basename, resolve } from "node:path";
import type { ApprovalMode } from "../ai/ai-tools.js";
import type { OpenAICompatibleCodingAgentOptions } from "../ai/coding-agent.js";
import { createSlashCommandAgent } from "./slash-agent.js";
import { maybeRunProviderSetup, type ProviderSetupMode } from "./provider-setup.js";
import { patchAiSdkTuiRenderer } from "./ai-sdk-tui-patch.js";
import { runFullscreen } from "./fullscreen.js";

export type OpenAICompatibleAiTuiOptions = OpenAICompatibleCodingAgentOptions & {
  readonly contextSize?: number;
  readonly toolDisplay?: TerminalPartDisplayMode;
  readonly reasoningDisplay?: TerminalPartDisplayMode;
  readonly providerSetupMode?: ProviderSetupMode;
  readonly resumeSession?: boolean;
  readonly resumeSessionId?: string;
  readonly sessionId?: string;
};

const DEFAULT_TOOL_DISPLAY: TerminalPartDisplayMode = "collapsed";
const DEFAULT_REASONING_DISPLAY: TerminalPartDisplayMode = "full";

/** Starts the interactive terminal UI for the OpenAI-compatible coding AI. */
export async function runOpenAICompatibleAiTui(options: OpenAICompatibleAiTuiOptions): Promise<void> {
  const configuredOptions = await maybeRunProviderSetup(options, {
    mode: options.providerSetupMode ?? "auto",
  });
  await patchAiSdkTuiRenderer();
  // Dynamic import is intentional: patchAiSdkTuiRenderer must update the dependency before module evaluation.
  const { runAgentTUI } = await import("@ai-sdk/tui");
  const approvalMode = configuredOptions.approvalMode ?? "safe";
  const agent = createSlashCommandAgent({
    ...configuredOptions,
    loggerScope: "tui",
    loggerLevel: "warn",
    resumeSession: configuredOptions.resumeSession,
    resumeSessionId: configuredOptions.resumeSessionId,
    sessionId: configuredOptions.sessionId,
  });

  await runFullscreen(async () => {
    await runAgentTUI({
      title: formatTuiTitle(configuredOptions.cwd, configuredOptions.model, approvalMode),
      agent,
      tools: configuredOptions.toolDisplay ?? DEFAULT_TOOL_DISPLAY,
      reasoning: configuredOptions.reasoningDisplay ?? DEFAULT_REASONING_DISPLAY,
      responseStatistics: "outputTokensPerSecond",
      contextSize: configuredOptions.contextSize,
    });
  });
}

function formatTuiTitle(cwd: string, model: string, approvalMode: ApprovalMode): string {
  const workspaceName = basename(resolve(cwd)) || resolve(cwd);
  return `π Harness · ${workspaceName} · ${model} · ${approvalMode} · ctx% · /settings /sessions /agents /compact`;
}
