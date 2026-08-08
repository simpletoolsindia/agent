import { runAgentTUI } from "@ai-sdk/tui";
import { isStepCount, ToolLoopAgent } from "ai";
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
};

/** Starts the interactive terminal UI for the OpenAI-compatible coding AI. */
export async function runOpenAICompatibleAiTui(options: OpenAICompatibleAiTuiOptions): Promise<void> {
  const logger = new JsonConsoleLogger("tui", "warn");
  const harness = createHarness(options.cwd, logger);
  const toolBundle = createAiToolBundle(harness.registry, harness.context, options.approvalMode ?? "safe");

  const runtime = new ToolLoopAgent({
    model: createOpenAICompatibleChatModel(options),
    instructions: CODING_INSTRUCTIONS,
    tools: toolBundle.tools,
    toolApproval: toolBundle.approvals,
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
  });

  await runAgentTUI({
    title: "Harness AI",
    agent: runtime,
    tools: "auto-collapsed",
    reasoning: "collapsed",
    responseStatistics: "outputTokensPerSecond",
  });
}
