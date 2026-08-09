import {
  pruneMessages,
  type Agent,
  type GenerateTextResult,
  type ModelMessage,
  type StreamTextResult,
} from "ai";
import type { ApprovalMode } from "../ai/ai-tools.js";
import {
  createOpenAICompatibleCodingAgent,
  type OpenAICompatibleCodingAgent,
  type OpenAICompatibleCodingAgentOptions,
} from "../ai/coding-agent.js";

const SETTINGS_KEYS = ["model", "base-url", "api-key", "provider-name", "approval", "max-steps"] as const;
const COMPACT_KEEP_MESSAGES = 8;
const PROCESSING_SPINNER_DELAY_MS = 250;
const PROCESSING_SPINNER_INTERVAL_MS = 350;

type SettingsKey = typeof SETTINGS_KEYS[number];
type RuntimeSettings = OpenAICompatibleCodingAgentOptions;
type CommandResult = {
  readonly text: string;
  readonly rebuildAgent?: boolean;
};

/** Adds local slash commands to the TUI without spending an LLM call. */
export function createSlashCommandAgent(options: OpenAICompatibleCodingAgentOptions): Agent {
  return new SlashCommandAgent(options) as unknown as Agent;
}

class SlashCommandAgent {
  public readonly version = "agent-v1";

  private settings: RuntimeSettings;
  private current: OpenAICompatibleCodingAgent;
  private compactNextPrompts = false;
  private compactRuns = 0;

  public constructor(options: OpenAICompatibleCodingAgentOptions) {
    this.settings = { ...options };
    this.current = createOpenAICompatibleCodingAgent(this.optionsWithTuiLogger());
  }

  public get id(): string | undefined {
    return this.current.agent.id;
  }

  public get tools(): unknown {
    return this.current.agent.tools;
  }

  public async generate(options: { readonly prompt?: unknown; readonly messages?: unknown }): Promise<unknown> {
    const slash = parseSlashCommand(extractPromptText(options));
    if (slash !== undefined) {
      const result = this.executeSlashCommand(slash);
      if (result.rebuildAgent === true) {
        this.rebuildAgent();
      }
      return syntheticGenerateResult(result.text);
    }

    return await this.current.agent.generate(this.prepareOptions(options) as never);
  }

  public async stream(options: { readonly prompt?: unknown; readonly messages?: unknown }): Promise<unknown> {
    const slash = parseSlashCommand(extractPromptText(options));
    if (slash !== undefined) {
      const result = this.executeSlashCommand(slash);
      if (result.rebuildAgent === true) {
        this.rebuildAgent();
      }
      return syntheticStreamResult(result.text);
    }

    const prepared = this.prepareOptions(options);
    return streamWithProcessingAnimation(() => this.current.agent.stream(prepared as never));
  }

  private prepareOptions<T extends { readonly prompt?: unknown; readonly messages?: unknown }>(options: T): T {
    if (!this.compactNextPrompts || !Array.isArray(options.prompt)) {
      return options;
    }

    const filtered = removeSlashCommandMessages(options.prompt as readonly ModelMessage[]);
    const recent = filtered.slice(-COMPACT_KEEP_MESSAGES);
    const compacted = pruneMessages({
      messages: recent,
      reasoning: "all",
      toolCalls: "before-last-5-messages",
      emptyMessages: "remove",
    });

    return {
      ...options,
      prompt: compacted,
    };
  }

  private executeSlashCommand(command: SlashCommand): CommandResult {
    switch (command.name) {
      case "help":
        return { text: slashHelpText(this.settings, this.compactNextPrompts, this.compactRuns) };
      case "settings":
        return this.applySettingsCommand(command.args);
      case "compact":
        this.compactNextPrompts = true;
        this.compactRuns += 1;
        return {
          text: [
            "## Context compacted",
            "Future model calls will drop slash-command chatter and keep the latest high-signal turns/tool results.",
            "Use `/settings show` to inspect the active model settings.",
          ].join("\n\n"),
        };
    }
  }

  private applySettingsCommand(args: readonly string[]): CommandResult {
    if (args.length === 0 || args[0] === "show") {
      return { text: formatSettings(this.settings, this.compactNextPrompts, this.compactRuns) };
    }

    const updates = parseSettingsUpdates(args);
    if (updates.length === 0) {
      return {
        text: [
          "## Settings command not understood",
          "Use `/settings show` or `/settings model <id> base-url <url> api-key <key>`.",
          `Known keys: ${SETTINGS_KEYS.join(", ")}.`,
        ].join("\n\n"),
      };
    }

    const messages: string[] = [];
    for (const update of updates) {
      messages.push(this.applySetting(update.key, update.value));
    }

    return {
      text: [
        "## Settings updated",
        ...messages.map((message) => `- ${message}`),
        "",
        formatSettings(this.settings, this.compactNextPrompts, this.compactRuns),
      ].join("\n"),
      rebuildAgent: true,
    };
  }

  private applySetting(key: SettingsKey, value: string): string {
    switch (key) {
      case "model":
        this.settings = { ...this.settings, model: requireValue(key, value) };
        return `model = ${this.settings.model}`;
      case "base-url":
        this.settings = { ...this.settings, baseURL: optionalValue(value) };
        return `base-url = ${this.settings.baseURL ?? "default OpenAI endpoint"}`;
      case "api-key":
        this.settings = { ...this.settings, apiKey: optionalValue(value) };
        return `api-key = ${this.settings.apiKey === undefined ? "unset" : "set"}`;
      case "provider-name":
        this.settings = { ...this.settings, providerName: optionalValue(value) };
        return `provider-name = ${this.settings.providerName ?? "openai-compatible"}`;
      case "approval":
        this.settings = { ...this.settings, approvalMode: parseApprovalValue(value) };
        return `approval = ${this.settings.approvalMode ?? "safe"}`;
      case "max-steps":
        this.settings = { ...this.settings, maxSteps: parsePositiveInteger(value, "max-steps") };
        return `max-steps = ${this.settings.maxSteps ?? "20"}`;
    }
  }

  private rebuildAgent(): void {
    this.current = createOpenAICompatibleCodingAgent(this.optionsWithTuiLogger());
  }

  private optionsWithTuiLogger(): OpenAICompatibleCodingAgentOptions {
    return {
      ...this.settings,
      loggerScope: this.settings.loggerScope ?? "tui",
      loggerLevel: this.settings.loggerLevel ?? "warn",
    };
  }
}

type SlashCommand =
  | { readonly name: "help"; readonly args: readonly string[] }
  | { readonly name: "settings"; readonly args: readonly string[] }
  | { readonly name: "compact"; readonly args: readonly string[] };

function parseSlashCommand(prompt: string): SlashCommand | undefined {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }

  const [rawName = "", ...args] = splitCommandLine(trimmed.slice(1));
  switch (rawName.toLowerCase()) {
    case "help":
    case "?":
      return { name: "help", args };
    case "settings":
    case "config":
      return { name: "settings", args };
    case "compact":
      return { name: "compact", args };
    default:
      return {
        name: "help",
        args,
      };
  }
}

function parseSettingsUpdates(args: readonly string[]): Array<{ readonly key: SettingsKey; readonly value: string }> {
  const updates: Array<{ readonly key: SettingsKey; readonly value: string }> = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex > 0) {
      const key = parseSettingsKey(token.slice(0, equalsIndex));
      if (key !== undefined) {
        updates.push({ key, value: token.slice(equalsIndex + 1) });
      }
      continue;
    }

    const key = parseSettingsKey(token);
    const value = args[index + 1];
    if (key !== undefined && value !== undefined) {
      updates.push({ key, value });
      index += 1;
    }
  }

  return updates;
}

function parseSettingsKey(value: string): SettingsKey | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "baseurl" || normalized === "base_url") {
    return "base-url";
  }
  if (normalized === "apikey" || normalized === "api_key") {
    return "api-key";
  }
  if (normalized === "provider" || normalized === "provider_name" || normalized === "provider-name") {
    return "provider-name";
  }
  if (normalized === "approval-mode" || normalized === "approvalmode") {
    return "approval";
  }

  return SETTINGS_KEYS.find((key) => key === normalized);
}

function formatSettings(settings: RuntimeSettings, compactEnabled: boolean, compactRuns: number): string {
  return [
    "## Active settings",
    "",
    `| Setting | Value |`,
    `| --- | --- |`,
    `| model | ${settings.model} |`,
    `| base-url | ${settings.baseURL ?? "default OpenAI endpoint"} |`,
    `| api-key | ${settings.apiKey === undefined ? "unset" : "set"} |`,
    `| provider-name | ${settings.providerName ?? "openai-compatible"} |`,
    `| approval | ${settings.approvalMode ?? "safe"} |`,
    `| max-steps | ${settings.maxSteps ?? 20} |`,
    `| compact | ${compactEnabled ? `enabled (${compactRuns})` : "not yet run"} |`,
    "",
    "Examples:",
    "",
    "```txt",
    "/settings model qwen2.5-coder:7b base-url http://localhost:11434/v1 api-key ollama",
    "/settings approval auto",
    "/compact",
    "```",
  ].join("\n");
}

function slashHelpText(settings: RuntimeSettings, compactEnabled: boolean, compactRuns: number): string {
  return [
    "## Slash commands",
    "",
    "| Command | Action |",
    "| --- | --- |",
    "| `/settings show` | Show active LLM config. |",
    "| `/settings model <id>` | Switch model for future turns. |",
    "| `/settings base-url <url>` | Switch OpenAI-compatible endpoint. |",
    "| `/settings api-key <key>` | Update API key; `none` unsets it. |",
    "| `/settings approval safe|auto` | Change tool approval mode. |",
    "| `/settings max-steps <count>` | Change agent loop step budget. |",
    "| `/compact` | Prune old slash chatter and tool-heavy history for future turns. |",
    "",
    formatSettings(settings, compactEnabled, compactRuns),
  ].join("\n");
}

function extractPromptText(options: { readonly prompt?: unknown; readonly messages?: unknown }): string {
  if (typeof options.prompt === "string") {
    return options.prompt;
  }
  if (Array.isArray(options.prompt)) {
    return extractTextFromLastUserMessage(options.prompt);
  }
  if (Array.isArray(options.messages)) {
    return extractTextFromLastUserMessage(options.messages);
  }
  return "";
}

function extractTextFromLastUserMessage(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (typeof message !== "object" || message === null || !("role" in message) || message.role !== "user") {
      continue;
    }
    const content = "content" in message ? message.content : undefined;
    return textFromContent(content);
  }
  return "";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content.map((part) => {
    if (typeof part !== "object" || part === null || !("text" in part)) {
      return "";
    }
    return typeof part.text === "string" ? part.text : "";
  }).join("");
}

function removeSlashCommandMessages(messages: readonly ModelMessage[]): readonly ModelMessage[] {
  const kept: ModelMessage[] = [];
  let dropNextAssistant = false;

  for (const message of messages) {
    const role = typeof message === "object" && message !== null && "role" in message && typeof message.role === "string"
      ? message.role
      : undefined;
    if (role === "assistant" && dropNextAssistant) {
      dropNextAssistant = false;
      continue;
    }

    const content = typeof message === "object" && message !== null && "content" in message ? message.content : undefined;
    if (role === "user" && textFromContent(content).trim().startsWith("/")) {
      dropNextAssistant = true;
      continue;
    }

    dropNextAssistant = false;
    kept.push(message);
  }

  return kept;
}


function splitCommandLine(input: string): string[] {
  const matches = input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g);
  return Array.from(matches, (match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function optionalValue(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return normalized === "none" || normalized === "unset" || normalized === "default" ? undefined : requireValue("setting", value);
}

function requireValue(key: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${key} requires a non-empty value`);
  }
  return trimmed;
}

function parseApprovalValue(value: string): ApprovalMode {
  if (value === "safe" || value === "auto") {
    return value;
  }
  throw new Error("approval must be safe or auto");
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function syntheticGenerateResult(text: string): GenerateTextResult<never, never, never> {
  return {
    text,
    content: [{ type: "text", text }],
  } as unknown as GenerateTextResult<never, never, never>;
}

function syntheticStreamResult(text: string): StreamTextResult<never, never, never> {
  const fullStream = syntheticFullStream(text);
  return {
    fullStream,
    stream: fullStream,
    text: Promise.resolve(text),
    content: Promise.resolve([{ type: "text", text }]),
  } as unknown as StreamTextResult<never, never, never>;
}

async function* syntheticFullStream(text: string): AsyncIterable<unknown> {
  yield { type: "start-step" };
  yield { type: "text-start", id: "slash-text" };
  yield { type: "text-delta", id: "slash-text", text };
  yield { type: "text-end", id: "slash-text" };
  yield {
    type: "finish-step",
    usage: { inputTokens: 0, outputTokens: Math.ceil(text.length / 4), totalTokens: Math.ceil(text.length / 4) },
    performance: { outputTokensPerSecond: 0 },
  };
  yield {
    type: "finish",
    finishReason: "stop",
    totalUsage: { inputTokens: 0, outputTokens: Math.ceil(text.length / 4), totalTokens: Math.ceil(text.length / 4) },
  };
}

async function streamWithProcessingAnimation(createResult: () => PromiseLike<unknown>): Promise<StreamTextResult<never, never, never>> {
  const resultPromise = Promise.resolve(createResult());
  const fullStream = animatedFullStream(resultPromise);
  return {
    fullStream,
    stream: fullStream,
  } as unknown as StreamTextResult<never, never, never>;
}

async function* animatedFullStream(resultPromise: Promise<unknown>): AsyncIterable<unknown> {
  let settled = false;
  let result: { readonly fullStream: AsyncIterable<unknown> } | undefined;
  let failure: unknown;

  resultPromise.then(
    (value) => {
      settled = true;
      result = value as { readonly fullStream: AsyncIterable<unknown> };
    },
    (error) => {
      settled = true;
      failure = error;
    },
  );

  await delay(PROCESSING_SPINNER_DELAY_MS);
  if (!settled) {
    yield { type: "start-step" };
    yield { type: "reasoning-start", id: "processing" };
    yield { type: "reasoning-delta", id: "processing", text: "Preparing model call" };
    while (!settled) {
      await delay(PROCESSING_SPINNER_INTERVAL_MS);
      if (!settled) {
        yield { type: "reasoning-delta", id: "processing", text: "." };
      }
    }
    yield { type: "reasoning-end", id: "processing" };
  }

  if (failure !== undefined) {
    throw failure;
  }

  const resolved = result ?? await resultPromise as { readonly fullStream: AsyncIterable<unknown> };
  yield* resolved.fullStream;
}

async function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

