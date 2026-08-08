import { createOpenAI } from "@ai-sdk/openai";
import { generateText, isStepCount } from "ai";
import { JsonConsoleLogger } from "../core/logger.js";
import { createHarness } from "../index.js";
import { createAiToolBundle, type ApprovalMode } from "./ai-tools.js";

export type OpenAICompatibleAiOptions = {
  readonly cwd: string;
  readonly prompt: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly providerName?: string;
  readonly maxSteps?: number;
  readonly approvalMode?: ApprovalMode;
};

export type OpenAICompatibleAiResult = {
  readonly text: string;
};

const CODING_INSTRUCTIONS = [
  "You are a precise coding harness using exactly five tools: search, bash, write, update, read.",
  "Use search before read when locating unknown code.",
  "Use read before update, then pass the fresh fileHash and rangeHash to update.",
  "Prefer update for existing files and write for new files or intentional full replacement.",
  "Use bash only for focused verification commands.",
  "When a tool returns ok=false, inspect its code and recover instead of repeating the same call.",
].join("\n");

export async function runOpenAICompatibleAi(options: OpenAICompatibleAiOptions): Promise<OpenAICompatibleAiResult> {
  const logger = new JsonConsoleLogger("ai", "info");
  const harness = createHarness(options.cwd, logger);
  const provider = createOpenAI({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.providerName === undefined ? {} : { name: options.providerName }),
  });
  const bundle = createAiToolBundle(harness.registry, harness.context, options.approvalMode ?? "safe");

  const result = await generateText({
    model: provider.chat(options.model),
    system: CODING_INSTRUCTIONS,
    tools: bundle.tools,
    toolApproval: bundle.approvals,
    stopWhen: isStepCount(options.maxSteps ?? 20),
    prompt: options.prompt,
  });
  return { text: result.text };
}
