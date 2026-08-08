#!/usr/bin/env node
import { Command } from "commander";
import { runOpenAICompatibleAi } from "../ai/openai-compatible-ai.js";
import { runOpenAICompatibleAiTui } from "../tui/ai-tui.js";

const program = new Command();

program
  .name("harness")
  .description("Five-tool coding harness prototype")
  .version("0.1.0");

program.command("ai")
  .description("Run one OpenAI-compatible LLM request")
  .requiredOption("-p, --prompt <prompt>", "user prompt to send to the AI")
  .option("--cwd <path>", "workspace root", process.cwd())
  .option("--model <model>", "model id", process.env.OPENAI_MODEL ?? "gpt-4o-mini")
  .option("--base-url <url>", "OpenAI-compatible API base URL", process.env.OPENAI_BASE_URL)
  .option("--api-key <key>", "API key", process.env.OPENAI_API_KEY)
  .option("--provider-name <name>", "provider name for logs", "openai-compatible")
  .option("--max-steps <count>", "maximum tool loop steps", "20")
  .option("--auto-approve", "allow write/update/bash tools without approval interruption")
  .action(async (options: {
    prompt: string;
    cwd: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    providerName?: string;
    maxSteps: string;
    autoApprove?: boolean;
  }) => {
    const result = await runOpenAICompatibleAi({
      cwd: options.cwd,
      prompt: options.prompt,
      model: options.model,
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
      providerName: options.providerName,
      maxSteps: Number.parseInt(options.maxSteps, 10),
      approvalMode: options.autoApprove === true ? "auto" : "safe",
    });

    process.stdout.write(`${result.text}\n`);
  });

program.command("tui")
  .description("Open the interactive terminal UI")
  .option("--cwd <path>", "workspace root", process.cwd())
  .option("--model <model>", "model id", process.env.OPENAI_MODEL ?? "gpt-4o-mini")
  .option("--base-url <url>", "OpenAI-compatible API base URL", process.env.OPENAI_BASE_URL)
  .option("--api-key <key>", "API key", process.env.OPENAI_API_KEY)
  .option("--provider-name <name>", "provider name for logs", "openai-compatible")
  .option("--max-steps <count>", "maximum tool loop steps", "20")
  .option("--auto-approve", "allow write/update/bash tools without approval interruption")
  .action(async (options: {
    cwd: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    providerName?: string;
    maxSteps: string;
    autoApprove?: boolean;
  }) => {
    await runOpenAICompatibleAiTui({
      cwd: options.cwd,
      model: options.model,
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
      providerName: options.providerName,
      maxSteps: Number.parseInt(options.maxSteps, 10),
      approvalMode: options.autoApprove === true ? "auto" : "safe",
    });
  });

await program.parseAsync();
