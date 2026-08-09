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
import { renderActivityPulse, renderCliPanel, renderKeyValueDeck, renderMetricStrip, renderProgressSteps, renderStatusBar } from "./status-bar.js";
import { formatSessionList, listSessions, loadSession, saveSession } from "./session-store.js";

const SETTINGS_KEYS = ["model", "base-url", "api-key", "provider-name", "approval", "agent-md", "skills-md"] as const;
const COMPACT_KEEP_MESSAGES = 8;
const PROCESSING_NOTICE_DELAY_MS = 250;
const SUGGESTION_INTERVAL_MS = 2_500;
const RUNTIME_SUGGESTIONS = [
  "Tip: use `search` first when you know a symbol or phrase.",
  "Tip: use `read` with line ranges to keep context small.",
  "Tip: use `update` after `read` for hash-guarded edits.",
  "Tip: use `write` for new files or intentional full replacements.",
  "Tip: use `bash` only for focused verification commands.",
  "Tip: use `/settings ollama` for local models.",
  "Tip: use `/settings auto` to reduce approval prompts in trusted workspaces.",
  "Tip: use `/compact` after long tool-heavy sessions.",
] as const;

type SettingsKey = typeof SETTINGS_KEYS[number];
type SlashCommandAgentOptions = OpenAICompatibleCodingAgentOptions & {
  readonly resumeSession?: boolean;
  readonly resumeSessionId?: string;
  readonly sessionId?: string;
};
type RuntimeSettings = OpenAICompatibleCodingAgentOptions;
type CommandResult = {
  readonly text: string;
  readonly rebuildAgent?: boolean;
};

/** Adds local slash commands to the TUI without spending an LLM call. */
export function createSlashCommandAgent(options: SlashCommandAgentOptions): Agent {
  return new SlashCommandAgent(options) as unknown as Agent;
}

class SlashCommandAgent {
  public readonly version = "agent-v1";

  private settings: RuntimeSettings;
  private current: OpenAICompatibleCodingAgent;
  private compactNextPrompts = false;
  private compactRuns = 0;
  private readonly resumeSession: boolean;
  private readonly resumeSessionId: string | undefined;
  private readonly sessionId: string | undefined;
  private sessionPrefix: readonly ModelMessage[] = [];
  private sessionLoaded = false;

  public constructor(options: SlashCommandAgentOptions) {
    this.settings = { ...options };
    this.resumeSession = options.resumeSession !== false;
    this.resumeSessionId = options.resumeSessionId;
    this.sessionId = options.sessionId;
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
      const result = await this.executeSlashCommand(slash);
      if (result.rebuildAgent === true) {
        this.rebuildAgent();
      }
      return syntheticGenerateResult(result.text);
    }

    return await this.current.agent.generate(await this.prepareOptions(options) as never);
  }

  public async stream(options: { readonly prompt?: unknown; readonly messages?: unknown }): Promise<unknown> {
    const slash = parseSlashCommand(extractPromptText(options));
    if (slash !== undefined) {
      const result = await this.executeSlashCommand(slash);
      if (result.rebuildAgent === true) {
        this.rebuildAgent();
      }
      return syntheticStreamResult(result.text);
    }

    const prepared = await this.prepareOptions(options);
    const baseMessages = Array.isArray(prepared.prompt) ? prepared.prompt as readonly ModelMessage[] : [];
    const result = await streamWithProcessingAnimation(() => this.current.agent.stream(prepared as never));
    return withSessionCapture(result, (assistantText) => this.persistSession(baseMessages, assistantText));
  }

  private async prepareOptions<T extends { readonly prompt?: unknown; readonly messages?: unknown }>(options: T): Promise<T> {
    const prompt = Array.isArray(options.prompt) ? await this.messagesWithSessionPrefix(options.prompt as readonly ModelMessage[]) : undefined;
    if (prompt === undefined && !this.compactNextPrompts) {
      return options;
    }

    const messages = prompt ?? options.prompt as readonly ModelMessage[];
    if (!this.compactNextPrompts || !Array.isArray(messages)) {
      return { ...options, prompt: messages } as T;
    }

    const filtered = removeSlashCommandMessages(messages);
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
    } as T;
  }

  private async executeSlashCommand(command: SlashCommand): Promise<CommandResult> {
    switch (command.name) {
      case "help":
        return { text: slashHelpText(this.settings, this.compactNextPrompts, this.compactRuns) };
      case "settings":
        return this.applySettingsCommand(command.args);
      case "agents":
        return { text: agentsHelpText() };
      case "sessions":
        return { text: formatSessionList(await listSessions()) };
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

  private async messagesWithSessionPrefix(messages: readonly ModelMessage[]): Promise<readonly ModelMessage[]> {
    await this.loadSessionPrefix();
    if (this.sessionPrefix.length === 0) {
      return messages;
    }
    return [...this.sessionPrefix, ...messages];
  }

  private async loadSessionPrefix(): Promise<void> {
    if (this.sessionLoaded) {
      return;
    }
    this.sessionLoaded = true;
    if (!this.resumeSession) {
      return;
    }
    const session = await loadSession(this.resumeSessionId, this.settings.cwd);
    if (session === undefined || session.messages.length === 0) {
      return;
    }
    this.sessionPrefix = session.messages;
  }

  private async persistSession(baseMessages: readonly ModelMessage[], assistantText: string): Promise<void> {
    if (baseMessages.length === 0 && assistantText.trim().length === 0) {
      return;
    }
    const messages = assistantText.trim().length === 0
      ? baseMessages
      : [...baseMessages, { role: "assistant" as const, content: assistantText }];
    await saveSession({
      id: this.sessionId,
      cwd: this.settings.cwd,
      model: this.settings.model,
      messages,
    });
  }

  private applySettingsCommand(args: readonly string[]): CommandResult {
    if (args.length === 0 || args[0] === "show" || args[0] === "menu") {
      return { text: formatSettings(this.settings, this.compactNextPrompts, this.compactRuns) };
    }
    if (args[0] === "help") {
      return { text: settingsHelpText() };
    }
    if (args[0] === "auto" || args[0] === "auto-approve" || args[0] === "safe") {
      this.settings = { ...this.settings, approvalMode: args[0] === "safe" ? "safe" : "auto" };
      return {
        text: [
          `## Approval ${this.settings.approvalMode === "auto" ? "auto" : "safe"} mode enabled`,
          this.settings.approvalMode === "auto"
            ? "Tools that are configured for auto approval can run without an approval prompt."
            : "Write and bash tools will ask for approval again.",
          "",
          formatSettings(this.settings, this.compactNextPrompts, this.compactRuns),
        ].join("\n"),
        rebuildAgent: true,
      };
    }
    if (args[0] === "ollama" || args[0] === "openai") {
      const messages = this.applySettingsPreset(args[0]);
      return {
        text: [
          `## ${args[0] === "ollama" ? "Ollama" : "OpenAI"} setup applied`,
          ...messages.map((message) => `- ${message}`),
          "",
          formatSettings(this.settings, this.compactNextPrompts, this.compactRuns),
        ].join("\n"),
        rebuildAgent: true,
      };
    }

    const updates = parseSettingsUpdates(args);
    if (updates.length === 0) {
      return {
        text: [
          "## Settings command not understood",
          "Use `/settings menu`, `/settings ollama`, or `/settings model <id> base-url <url> api-key <key>`.",
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

  private applySettingsPreset(preset: "ollama" | "openai"): readonly string[] {
    if (preset === "ollama") {
      this.settings = {
        ...this.settings,
        model: this.settings.model.trim().length === 0 || this.settings.model === "gpt-4o-mini" ? "qwen2.5-coder:7b" : this.settings.model,
        baseURL: "http://localhost:11434/v1",
        apiKey: "ollama",
      };
      return ["base-url = http://localhost:11434/v1", "api-key = set", `model = ${this.settings.model}`];
    }

    this.settings = { ...this.settings, baseURL: undefined };
    return ["base-url = default OpenAI endpoint", `model = ${this.settings.model}`, `api-key = ${this.settings.apiKey === undefined ? "unset" : "set"}`];
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
      case "agent-md":
        this.settings = { ...this.settings, agentMdPath: optionalValue(value) };
        return `agent-md = ${this.settings.agentMdPath ?? "unset"}`;
      case "skills-md":
        this.settings = { ...this.settings, skillsMdPath: optionalValue(value) };
        return `skills-md = ${this.settings.skillsMdPath ?? "unset"}`;
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
  | { readonly name: "compact"; readonly args: readonly string[] }
  | { readonly name: "agents"; readonly args: readonly string[] }
  | { readonly name: "sessions"; readonly args: readonly string[] };

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
    case "agents":
    case "subagents":
      return { name: "agents", args };
    case "sessions":
    case "resume":
      return { name: "sessions", args };
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
  if (normalized === "agentmd" || normalized === "agent_md" || normalized === "agent-file") {
    return "agent-md";
  }
  if (normalized === "skillsmd" || normalized === "skills_md" || normalized === "skills-file") {
    return "skills-md";
  }

  return SETTINGS_KEYS.find((key) => key === normalized);
}

function formatSettings(settings: RuntimeSettings, compactEnabled: boolean, compactRuns: number): string {
  const docsLoaded = [settings.agentMdPath, settings.skillsMdPath].filter((value) => value !== undefined).length;
  return [
    "## Settings cockpit",
    "",
    renderKeyValueDeck("Active profile", [
      { label: "model", value: settings.model, tone: "busy" },
      { label: "endpoint", value: settings.baseURL ?? "OpenAI default", tone: settings.baseURL === undefined ? "idle" : "success" },
      { label: "approval", value: settings.approvalMode ?? "safe", tone: (settings.approvalMode ?? "safe") === "auto" ? "success" : "warn" },
      { label: "docs", value: `${docsLoaded}/2`, tone: docsLoaded === 0 ? "idle" : "success" },
      { label: "compact", value: compactEnabled ? `${compactRuns}` : "off", tone: compactEnabled ? "success" : "idle" },
    ], 78),
    "",
    renderCliPanel("Quick actions", [
      "`/settings ollama`  Local Ollama defaults in one command.",
      "`/settings auto`  Auto approval for trusted workspaces.",
      "`/settings safe`  Restore approval prompts.",
      "`/settings openai`  Clear custom endpoint and key.",
      "`/settings help`  Show command-only reference.",
    ], 78),
    "",
    "| Setting | Value |",
    "| --- | --- |",
    `| model | ${settings.model} |`,
    `| base-url | ${settings.baseURL ?? "default OpenAI endpoint"} |`,
    `| api-key | ${settings.apiKey === undefined ? "unset" : "set"} |`,
    `| provider-name | ${settings.providerName ?? "openai-compatible"} |`,
    `| approval | ${settings.approvalMode ?? "safe"} |`,
    `| agent-md | ${settings.agentMdPath ?? "unset"} |`,
    `| skills-md | ${settings.skillsMdPath ?? "unset"} |`,
    `| compact | ${compactEnabled ? `enabled (${compactRuns})` : "not yet run"} |`,
    "",
    "```txt",
    "/settings ollama",
    "/settings model qwen2.5-coder:7b",
    "/settings auto",
    "/settings approval auto",
    "/settings agent-md AGENT.md skills-md SKILLS.md",
    "/settings api-key none",
    "```",
    "",
    `Runtime suggestion: ${pickRuntimeSuggestion(0)}`,
  ].join("\n");
}

function settingsHelpText(): string {
  return [
    "## Settings command deck",
    "",
    "| Command | Action |",
    "| --- | --- |",
    "| `/settings menu` | Show the modern setup cockpit, active values, and examples. |",
    "| `/settings ollama` | Configure local Ollama defaults. |",
    "| `/settings auto` or `/settings auto-approve` | Turn on auto approval for trusted workspaces. |",
    "| `/settings safe` | Turn approval prompts back on. |",
    "| `/settings openai` | Use the default OpenAI endpoint. |",
    "| `/settings model <id>` | Switch model for future turns. |",
    "| `/settings base-url <url>` | Switch OpenAI-compatible endpoint. `none` clears it. |",
    "| `/settings api-key <key>` | Update API key. `none` unsets it. |",
    "| `/settings approval safe|auto` | Change tool approval mode. |",
    "| `/settings agent-md <path>` | Load additional agent instructions markdown. `none` unsets it. |",
    "| `/settings skills-md <path>` | Load additional skills markdown. `none` unsets it. |",
    "",
    `Tip: ${pickRuntimeSuggestion(1)}`,
  ].join("\n");
}

function slashHelpText(settings: RuntimeSettings, compactEnabled: boolean, compactRuns: number): string {
  return [
    "## Command center",
    "",
    renderCliPanel("Slash deck", [
      "`/settings menu`  OMP-style cockpit with segmented profile and examples.",
      "`/settings ollama`  Local Ollama in one command.",
      "`/settings auto`  Reduce approval friction in trusted workspaces.",
      "`/compact`  Prune old slash chatter and tool-heavy history.",
      "`/sessions`  List the five saved resumable sessions.",
      "`/agents`  Show read-only subagent delegation modes.",
      renderProgressSteps(["configure", "chat", "tools", "verify"], 1, 74),
    ], 78),
    "",
    formatSettings(settings, compactEnabled, compactRuns),
  ].join("\n");
}

function agentsHelpText(): string {
  return [
    "## Built-in subagents",
    "",
    renderCliPanel("Read-only delegation", [
      renderMetricStrip([
        { label: "research", value: "map code", tone: "busy" },
        { label: "review", value: "find regressions", tone: "warn" },
        { label: "plan", value: "no edits", tone: "idle" },
      ], 74),
      "`research` maps unfamiliar code or collects references before an edit.",
      "`review` checks a proposed change or subagent handoff for regressions and missing verification.",
      "`plan` creates a non-mutating implementation plan for larger work.",
      "Loop: analyze user task -> create todos -> delegate one context-heavy task -> validate handoff -> edit or re-delegate.",
      "Main agent keeps edits, verification, final todo state, and subagent stop recovery so context stays clean.",
    ], 78),
    "",
    "| Role | Use when | Tools | Required input |",
    "| --- | --- | --- | --- |",
    "| `research` | Mapping unfamiliar code or collecting references before an edit. | `search`, `read` | `taskGoal` |",
    "| `review` | Checking a proposed change for bugs, regressions, and missing verification. | `search`, `read` | `taskGoal` |",
    "| `plan` | Creating a non-mutating implementation plan for larger work. | `search`, `read` | `taskGoal` |",
    "",
    "Example model-facing delegation:",
    "",
    "```json",
    "{ \"role\": \"research\", \"taskGoal\": \"Map TUI startup flow\", \"referenceFiles\": [{ \"path\": \"src/tui/ai-tui.ts\", \"reason\": \"TUI startup pattern\" }] }",
    "```",
    "",
    "Edits still happen in the main agent with normal `update`/`write` approval; subagent output is a compact handoff, not trusted until the main agent validates it. Press `Esc` or `Ctrl+C` during work to interrupt the current stream, abort any active subagent, and open the prompt immediately so the next user message can redirect or queue the next task.",
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

function withSessionCapture(
  result: StreamTextResult<never, never, never>,
  onComplete: (assistantText: string) => Promise<void>,
): StreamTextResult<never, never, never> {
  const fullStream = captureSessionStream(result.fullStream, onComplete);
  return {
    ...result,
    fullStream,
    stream: fullStream,
  } as StreamTextResult<never, never, never>;
}

async function* captureSessionStream(stream: AsyncIterable<unknown>, onComplete: (assistantText: string) => Promise<void>): AsyncIterable<unknown> {
  let assistantText = "";
  try {
    for await (const chunk of stream) {
      const record = asRecord(chunk);
      if (record?.type === "text-delta") {
        assistantText += readString(record, "text") ?? "";
      }
      yield chunk;
    }
  } finally {
    await onComplete(assistantText);
  }
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

  await delay(PROCESSING_NOTICE_DELAY_MS);
  if (!settled) {
    let suggestionIndex = randomSuggestionIndex();
    let ticks = 0;
    yield { type: "start-step" };
    yield { type: "reasoning-start", id: "processing" };
    yield {
      type: "reasoning-delta",
      id: "processing",
      text: renderActivityPulse("Processing", `Starting model stream. ${pickRuntimeSuggestion(suggestionIndex)}`, 72, ticks, "busy"),
    };
    while (!settled) {
      await delay(250);
      ticks += 1;
      if (!settled && ticks % Math.max(1, Math.round(SUGGESTION_INTERVAL_MS / 250)) === 0) {
        suggestionIndex = nextSuggestionIndex(suggestionIndex);
        yield {
          type: "reasoning-delta",
          id: "processing",
          text: `\n${renderActivityPulse("Still running", pickRuntimeSuggestion(suggestionIndex), 72, ticks, "busy")}`,
        };
      }
    }
    yield { type: "reasoning-end", id: "processing" };
  }

  if (failure !== undefined) {
    throw failure;
  }

  const resolved = result ?? await resultPromise as { readonly fullStream: AsyncIterable<unknown> };
  yield* withInlineProgress(resolved.fullStream);
}

export async function* withInlineProgress(stream: AsyncIterable<unknown>): AsyncIterable<unknown> {
  let step = 0;
  let currentStatusId: string | undefined;
  let suggestionIndex = randomSuggestionIndex();
  const toolNames = new Map<string, string>();
  const activeToolCalls = new Set<string>();
  const iterator = stream[Symbol.asyncIterator]();
  let nextChunk = iterator.next().then(toStreamChunk);

  while (true) {
    const waitResult = currentStatusId === undefined
      ? await nextChunk
      : await Promise.race([
        nextChunk,
        suggestionTick(SUGGESTION_INTERVAL_MS),
      ]);

    if (waitResult.type === "suggestion") {
      suggestionIndex = nextSuggestionIndex(suggestionIndex);
      yield {
        type: "reasoning-delta",
        id: currentStatusId,
        text: `\n${renderActivityPulse("Suggestion", pickRuntimeSuggestion(suggestionIndex), 72, suggestionIndex, "idle")}`,
      };
      continue;
    }

    if (waitResult.result.done === true) {
      break;
    }

    const chunk = waitResult.result.value;
    nextChunk = iterator.next().then(toStreamChunk);
    const record = asRecord(chunk);
    const chunkType = typeof record?.type === "string" ? record.type : "";

    if (chunkType === "start-step") {
      step += 1;
      currentStatusId = `harness-progress-${step}`;
      suggestionIndex = nextSuggestionIndex(suggestionIndex);
      activeToolCalls.clear();
      yield chunk;
      yield { type: "reasoning-start", id: currentStatusId };
      yield {
        type: "reasoning-delta",
        id: currentStatusId,
        text: `${renderProgressSteps(["think", "tools", "review", "answer"], 0, 72)}\n${renderActivityPulse(`Step ${step}`, `Thinking. ${pickRuntimeSuggestion(suggestionIndex)}`, 72, step, "busy")}`,
      };
      continue;
    }

    if (record !== undefined && currentStatusId !== undefined && chunkType === "tool-input-start") {
      const toolName = readString(record, "toolName") ?? "tool";
      const toolCallId = readString(record, "toolCallId");
      if (toolCallId !== undefined) {
        toolNames.set(toolCallId, toolName);
        activeToolCalls.add(toolCallId);
      }
      yield {
        type: "reasoning-delta",
        id: currentStatusId,
        text: `\n${renderProgressSteps(["think", "tools", "review", "answer"], 1, 72)}\n${renderStatusBar("Tool", `${parallelPrefix(activeToolCalls.size)}${toolName} input streaming. ${toolSuggestion(toolName)}`, 72, "busy", 0.45)}`,
      };
    }

    if (record !== undefined && currentStatusId !== undefined && chunkType === "tool-input-available") {
      const toolName = toolNameFor(record, toolNames);
      const toolCallId = readString(record, "toolCallId");
      if (toolCallId !== undefined) {
        activeToolCalls.add(toolCallId);
      }
      yield {
        type: "reasoning-delta",
        id: currentStatusId,
        text: `\n${renderProgressSteps(["think", "tools", "review", "answer"], 1, 72)}\n${renderStatusBar("Tool", `${parallelPrefix(activeToolCalls.size)}${toolRunMessage(toolName, record)}`, 72, "busy", 0.65)}`,
      };
    }

    if (record !== undefined && currentStatusId !== undefined && (chunkType === "tool-output-available" || chunkType === "tool-output-denied" || chunkType === "tool-output-error")) {
      const toolName = toolNameFor(record, toolNames);
      const failed = chunkType === "tool-output-error" || chunkType === "tool-output-denied";
      const toolCallId = readString(record, "toolCallId");
      if (toolCallId !== undefined) {
        activeToolCalls.delete(toolCallId);
      }
      yield {
        type: "reasoning-delta",
        id: currentStatusId,
        text: `\n${renderProgressSteps(["think", "tools", "review", "answer"], failed ? 2 : 3, 72)}\n${renderStatusBar("Tool", `${toolName} ${failed ? "needs attention" : "complete"}.`, 72, failed ? "warn" : "success", failed ? 0.4 : 1)}`,
      };
    }

    if (chunkType === "finish-step" && currentStatusId !== undefined) {
      yield {
        type: "reasoning-delta",
        id: currentStatusId,
        text: `\n${renderProgressSteps(["think", "tools", "review", "answer"], 3, 72)}\n${renderStatusBar(`Step ${step}`, "Step complete.", 72, "success", 1)}`,
      };
      yield { type: "reasoning-end", id: currentStatusId };
      currentStatusId = undefined;
    }

    if (chunkType === "finish" && currentStatusId !== undefined) {
      yield { type: "reasoning-end", id: currentStatusId };
      currentStatusId = undefined;
    }

    yield chunk;
  }
}

type StreamWaitResult =
  | { readonly type: "chunk"; readonly result: IteratorResult<unknown> }
  | { readonly type: "suggestion" };

function toStreamChunk(result: IteratorResult<unknown>): StreamWaitResult {
  return { type: "chunk", result };
}

function suggestionTick(ms: number): Promise<StreamWaitResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ type: "suggestion" }), ms);
    timer.unref?.();
  });
}

export function pickRuntimeSuggestion(seed: number = randomSuggestionIndex()): string {
  return RUNTIME_SUGGESTIONS[Math.abs(Math.trunc(seed)) % RUNTIME_SUGGESTIONS.length];
}

function randomSuggestionIndex(): number {
  return Math.floor(Math.random() * RUNTIME_SUGGESTIONS.length);
}

function nextSuggestionIndex(current: number): number {
  if (RUNTIME_SUGGESTIONS.length < 2) {
    return 0;
  }
  return (current + 1 + Math.floor(Math.random() * (RUNTIME_SUGGESTIONS.length - 1))) % RUNTIME_SUGGESTIONS.length;
}

function toolSuggestion(toolName: string): string {
  switch (toolName) {
    case "search":
      return "Search is fastest for locating code before reading files.";
    case "read":
      return "Line ranges keep the model focused.";
    case "update":
      return "Hash checks protect against stale edits.";
    case "write":
      return "Use overwrite only for intentional replacements.";
    case "bash":
      return "Keep commands focused on verification.";
    case "subagent":
      return "Delegate broad research without filling the main context.";
    default:
      return pickRuntimeSuggestion();
  }
}

function parallelPrefix(activeCount: number): string {
  return activeCount > 1 ? `parallel x${activeCount}: ` : "";
}

function toolRunMessage(toolName: string, record: Record<string, unknown>): string {
  const input = asRecord(record.input);
  if (toolName === "bash") {
    const command = input === undefined ? undefined : readString(input, "command");
    return command === undefined ? "bash running." : `bash running: ${command}`;
  }
  if (toolName === "subagent") {
    const goal = input === undefined ? undefined : readString(input, "taskGoal");
    return goal === undefined ? "subagent running · Esc/Ctrl+C interrupts and asks next." : `subagent running: ${goal} · Esc/Ctrl+C interrupts and asks next.`;
  }
  return `${toolName} running. ${toolSuggestion(toolName)}`;
}

function toolNameFor(record: Record<string, unknown>, toolNames: ReadonlyMap<string, string>): string {
  const toolCallId = readString(record, "toolCallId");
  if (toolCallId === undefined) {
    return "tool";
  }
  return toolNames.get(toolCallId) ?? "tool";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

async function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

