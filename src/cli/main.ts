#!/usr/bin/env node
import { Command } from "commander";
import { runOpenAICompatibleAi } from "../ai/openai-compatible-ai.js";
import { runOpenAICompatibleAiTui } from "../tui/ai-tui.js";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const DEFAULT_PROVIDER_NAME = "openai-compatible";
const DEFAULT_MAX_STEPS = "20";

type SharedAgentCommandOptions = {
  readonly cwd: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly providerName?: string;
  readonly maxSteps: string;
  readonly autoApprove?: boolean;
};

type OneShotAgentCommandOptions = SharedAgentCommandOptions & {
  readonly prompt: string;
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

addSharedAgentOptions(
  program.command("tui")
    .description("Open the interactive terminal UI"),
).action(async (options: SharedAgentCommandOptions) => {
  await runOpenAICompatibleAiTui(toRuntimeOptions(options));
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
    .option("--auto-approve", "allow write/update/bash tools without approval interruption");
}

function toRuntimeOptions(options: SharedAgentCommandOptions) {
  return {
    cwd: options.cwd,
    model: options.model,
    baseURL: options.baseUrl,
    apiKey: options.apiKey,
    providerName: options.providerName,
    maxSteps: parseMaxSteps(options.maxSteps),
    approvalMode: options.autoApprove === true ? "auto" as const : "safe" as const,
  };
}

function parseMaxSteps(value: string): number {
  const maxSteps = Number.parseInt(value, 10);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error(`--max-steps must be a positive integer, received: ${value}`);
  }

  return maxSteps;
}
