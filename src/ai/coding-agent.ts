import {
  isStepCount,
  pruneMessages,
  ToolLoopAgent,
  type ModelMessage,
} from "ai";
import { createHarness } from "../index.js";
import type { Logger } from "../core/logger.js";
import { JsonConsoleLogger } from "../core/logger.js";
import { loadInstructionDocuments, type ContextFileOptions } from "./context-files.js";
import { createAiToolBundle, type ApprovalMode } from "./ai-tools.js";
import {
  DEFAULT_CONTEXT_SIZE,
  createCodingInstructions,
  createOpenAICompatibleChatModel,
  type OpenAICompatibleModelOptions,
} from "./openai-compatible-runtime.js";

const TOOL_ORDER = ["subagent", "search", "read", "update", "write", "bash"] as const;
const PARALLEL_TOOL_HINT = "Issue independent read/search/bash/subagent calls in the same model step so the runtime can execute them in parallel; keep write/update calls serialized when they touch the same file.";
const COMPACTION_RATIO = 0.7;
const RECENT_TOOL_MESSAGES_TO_KEEP = 5;
const LOOP_STEP_LIMIT = 80;

export type OpenAICompatibleCodingAgentOptions = OpenAICompatibleModelOptions & ContextFileOptions & {
  readonly cwd: string;
  readonly approvalMode?: ApprovalMode;
  readonly contextSize?: number;
  readonly logger?: Logger;
  readonly loggerScope?: string;
  readonly loggerLevel?: "debug" | "info" | "warn" | "error";
};

export type OpenAICompatibleCodingAgent = {
  readonly agent: ToolLoopAgent;
  readonly approvalMode: ApprovalMode;
};

/** Builds the coding agent once so CLI and TUI share identical loop behavior. */
export function createOpenAICompatibleCodingAgent(options: OpenAICompatibleCodingAgentOptions): OpenAICompatibleCodingAgent {
  const logger = options.logger ?? new JsonConsoleLogger(options.loggerScope ?? "agent", options.loggerLevel ?? "info");
  const harness = createHarness(options.cwd, logger);
  const approvalMode = options.approvalMode ?? "safe";
  const toolBundle = createAiToolBundle(harness.registry, harness.context, approvalMode, {
    subagent: {
      model: options.model,
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      providerName: options.providerName,
    },
  });
  const contextSize = options.contextSize ?? DEFAULT_CONTEXT_SIZE;
  const instructions = `${createCodingInstructions(options.cwd, loadInstructionDocuments(options.cwd, options))}\n${PARALLEL_TOOL_HINT}`;

  const agent = new ToolLoopAgent({
    model: createOpenAICompatibleChatModel(options),
    instructions,
    tools: toolBundle.tools,
    toolApproval: toolBundle.approvals,
    toolOrder: [...TOOL_ORDER],
    stopWhen: isStepCount(LOOP_STEP_LIMIT),
    prepareStep: ({ stepNumber, steps, messages }) => {
      const failureHint = formatFailureHint(steps);
      const compactedMessages = safeCompactedMessages(messages, contextSize, logger);

      return {
        toolOrder: [...TOOL_ORDER],
        temperature: stepNumber === 0 ? 0 : undefined,
        ...(failureHint === undefined ? {} : { instructions: `${instructions}\n\n${failureHint}` }),
        ...(compactedMessages === undefined ? {} : { messages: compactedMessages }),
      };
    },
    onStepEnd: ({ stepNumber, finishReason, toolCalls, usage, performance }) => {
      logger.info("agent.step", {
        stepNumber,
        finishReason,
        tools: toolCalls.map((toolCall) => toolCall.toolName),
        totalTokens: usage.totalTokens,
        elapsedMs: performance.stepTimeMs,
      });
    },
  });

  return { agent, approvalMode };
}


function safeCompactedMessages(messages: ModelMessage[], contextSize: number, logger: Logger): ModelMessage[] | undefined {
  if (!shouldCompact(messages, contextSize)) {
    return undefined;
  }

  try {
    return pruneMessages({
      messages,
      reasoning: "all",
      toolCalls: `before-last-${RECENT_TOOL_MESSAGES_TO_KEEP}-messages`,
      emptyMessages: "remove",
    });
  } catch (error) {
    logger.warn("agent.compaction.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
function shouldCompact(messages: readonly ModelMessage[], contextSize: number): boolean {
  return estimateTokens(messages) > contextSize * COMPACTION_RATIO;
}

function estimateTokens(messages: readonly ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

type ToolFailure = {
  readonly toolName: string;
  readonly code: string;
  readonly error: string;
};

function formatFailureHint(steps: readonly unknown[]): string | undefined {
  const failures = latestToolFailures(steps);
  if (failures.length === 0) {
    return undefined;
  }

  return [
    "Failure recovery protocol for small models:",
    "1. Tool ok=false is normal feedback, not a reason to stop.",
    "2. Do not repeat the same call unchanged.",
    "3. Use the next action below, then continue the task loop and update todo only after verification.",
    ...failures.slice(0, 3).map(formatFailureRecovery),
  ].join("\n");
}

function latestToolFailures(steps: readonly unknown[]): ToolFailure[] {
  const lastStep = steps.at(-1) as { readonly toolResults?: readonly unknown[] } | undefined;
  const results = lastStep?.toolResults ?? [];
  const failures: ToolFailure[] = [];

  for (const result of results) {
    const toolName = readStringProperty(result, "toolName") ?? "tool";
    const output = readObjectProperty(result, "output");
    if (output === undefined || output.ok !== false) {
      continue;
    }

    failures.push({
      toolName,
      code: readStringProperty(output, "code") ?? "TOOL_FAILED",
      error: readStringProperty(output, "error") ?? "Tool failed",
    });
  }

  return failures;
}

function formatFailureRecovery(failure: ToolFailure): string {
  return [
    `- location=${failure.toolName}`,
    `code=${failure.code}`,
    `observed=${failure.error}`,
    `next=${recoveryAction(failure)}`,
  ].join(" | ");
}

function recoveryAction(failure: ToolFailure): string {
  switch (failure.code) {
    case "SCHEMA_INVALID":
      return "Fix the tool input shape from the schema; include required fields and valid types.";
    case "PATH_NOT_FOUND":
      return "Search or list the parent directory, then retry with a discovered path.";
    case "PATH_ESCAPE":
      return "Stay inside the workspace; use a relative workspace path.";
    case "WRITE_EXISTS":
      return "Use update for existing files, or write with overwrite=true only for intentional full replacement.";
    case "READ_RANGE_INVALID":
    case "UPDATE_RANGE_INVALID":
      return "Re-read the file slice and use valid current line numbers.";
    case "UPDATE_STALE_FILE":
    case "UPDATE_RANGE_CHANGED":
      return "Re-read the target range and retry with fresh fileHash and rangeHash.";
    case "BASH_SPAWN_FAILED":
      return "Use a normal shell command string from the correct cwd, for example npm run build.";
    case "BASH_TIMEOUT":
      return "Narrow the command or raise timeoutMs only when the command is expected to run longer.";
    case "SUBAGENT_ABORTED":
      return "User stopped the subagent; continue with current evidence or create a narrower subagent task if still needed.";
    case "SUBAGENT_FAILED":
      return "Create a narrower read-only subagent task with explicit references, or inspect the key file directly.";
    case "TOOL_NOT_FOUND":
      return "Choose one available tool: subagent, search, read, update, write, or bash.";
    default:
      return "Change strategy before retrying; collect missing context or choose a safer tool.";
  }
}

function readObjectProperty(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "object" && property !== null ? property as Record<string, unknown> : undefined;
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}
