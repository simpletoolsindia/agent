import { runAgentTUI, type TerminalPartDisplayMode } from "@ai-sdk/tui";
import { isStepCount, ToolLoopAgent } from "ai";
import { basename, resolve } from "node:path";
import { createAiToolBundle, type ApprovalMode } from "../ai/ai-tools.js";
import {
  CODING_INSTRUCTIONS,
  DEFAULT_MAX_STEPS,
  createOpenAICompatibleChatModel,
  type OpenAICompatibleModelOptions,
} from "../ai/openai-compatible-runtime.js";
import { JsonConsoleLogger } from "../core/logger.js";
import { createHarness } from "../index.js";

export type OpenAICompatibleAiTuiOptions = OpenAICompatibleModelOptions & {
  readonly cwd: string;
  readonly maxSteps?: number;
  readonly approvalMode?: ApprovalMode;
  readonly contextSize?: number;
  readonly toolDisplay?: TerminalPartDisplayMode;
  readonly reasoningDisplay?: TerminalPartDisplayMode;
};

const DEFAULT_TOOL_DISPLAY: TerminalPartDisplayMode = "collapsed";
const DEFAULT_REASONING_DISPLAY: TerminalPartDisplayMode = "collapsed";

/** Starts the interactive terminal UI for the OpenAI-compatible coding AI. */
export async function runOpenAICompatibleAiTui(options: OpenAICompatibleAiTuiOptions): Promise<void> {
  const logger = new JsonConsoleLogger("tui", "warn");
  const harness = createHarness(options.cwd, logger);
  const approvalMode = options.approvalMode ?? "safe";
  const toolBundle = createAiToolBundle(harness.registry, harness.context, approvalMode);

  const runtime = new ToolLoopAgent({
    model: createOpenAICompatibleChatModel(options),
    instructions: CODING_INSTRUCTIONS,
    tools: toolBundle.tools,
    toolApproval: toolBundle.approvals,
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
  });

  await runAgentTUI({
    title: formatTuiTitle(options.cwd, options.model, approvalMode),
    agent: runtime,
    tools: options.toolDisplay ?? DEFAULT_TOOL_DISPLAY,
    reasoning: options.reasoningDisplay ?? DEFAULT_REASONING_DISPLAY,
    responseStatistics: "outputTokensPerSecond",
    contextSize: options.contextSize,
  });
}

function formatTuiTitle(cwd: string, model: string, approvalMode: ApprovalMode): string {
  const workspaceName = basename(resolve(cwd)) || resolve(cwd);
  return `Harness AI · ${workspaceName} · ${model} · ${approvalMode}`;
}
