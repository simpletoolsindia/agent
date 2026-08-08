import { createOpenAI } from "@ai-sdk/openai";
import { runAgentTUI } from "@ai-sdk/tui";
import { isStepCount, ToolLoopAgent } from "ai";
import { JsonConsoleLogger } from "../core/logger.js";
import { createHarness } from "../index.js";
import { createAiToolBundle, type ApprovalMode } from "../ai/ai-tools.js";

export type OpenAICompatibleAiTuiOptions = {
  readonly cwd: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly providerName?: string;
  readonly maxSteps?: number;
  readonly approvalMode?: ApprovalMode;
};

const TUI_INSTRUCTIONS = [
  "You are a precise coding AI using exactly five tools: search, bash, write, update, read.",
  "Use search before read when locating unknown code.",
  "Use read before update, then pass the fresh fileHash and rangeHash to update.",
  "Prefer update for existing files and write for new files or intentional full replacement.",
  "Use bash only for focused verification commands.",
  "When a tool returns ok=false, inspect its code and recover instead of repeating the same call.",
].join("\n");

/** Starts the interactive terminal UI for the OpenAI-compatible coding AI. */
export async function runOpenAICompatibleAiTui(options: OpenAICompatibleAiTuiOptions): Promise<void> {
  const logger = new JsonConsoleLogger("tui", "warn");
  const harness = createHarness(options.cwd, logger);
  const provider = createOpenAI({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.providerName === undefined ? {} : { name: options.providerName }),
  });
  const bundle = createAiToolBundle(harness.registry, harness.context, options.approvalMode ?? "safe");

  const runtime = new ToolLoopAgent({
    model: provider.chat(options.model),
    instructions: TUI_INSTRUCTIONS,
    tools: bundle.tools,
    toolApproval: bundle.approvals,
    stopWhen: isStepCount(options.maxSteps ?? 20),
  });

  await runAgentTUI({
    title: "Harness AI",
    agent: runtime,
    tools: "auto-collapsed",
    reasoning: "collapsed",
    responseStatistics: "outputTokensPerSecond",
  });
}
