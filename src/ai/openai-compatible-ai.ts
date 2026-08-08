import { generateText, isStepCount } from "ai";
import { JsonConsoleLogger } from "../core/logger.js";
import { createHarness } from "../index.js";
import { createAiToolBundle, type ApprovalMode } from "./ai-tools.js";
import {
  CODING_INSTRUCTIONS,
  DEFAULT_MAX_STEPS,
  createOpenAICompatibleChatModel,
  type OpenAICompatibleModelOptions,
} from "./openai-compatible-runtime.js";

export type OpenAICompatibleAiOptions = OpenAICompatibleModelOptions & {
  readonly cwd: string;
  readonly prompt: string;
  readonly maxSteps?: number;
  readonly approvalMode?: ApprovalMode;
};

export type OpenAICompatibleAiResult = {
  readonly text: string;
};

export async function runOpenAICompatibleAi(options: OpenAICompatibleAiOptions): Promise<OpenAICompatibleAiResult> {
  const logger = new JsonConsoleLogger("ai", "info");
  const harness = createHarness(options.cwd, logger);
  const toolBundle = createAiToolBundle(harness.registry, harness.context, options.approvalMode ?? "safe");

  const result = await generateText({
    model: createOpenAICompatibleChatModel(options),
    system: CODING_INSTRUCTIONS,
    tools: toolBundle.tools,
    toolApproval: toolBundle.approvals,
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
    prompt: options.prompt,
  });

  return { text: result.text };
}
