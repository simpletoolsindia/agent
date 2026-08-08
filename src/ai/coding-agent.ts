import {
  isStepCount,
  pruneMessages,
  ToolLoopAgent,
  type ModelMessage,
} from "ai";
import { createHarness } from "../index.js";
import type { Logger } from "../core/logger.js";
import { JsonConsoleLogger } from "../core/logger.js";
import { createAiToolBundle, type ApprovalMode } from "./ai-tools.js";
import {
  CODING_INSTRUCTIONS,
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_MAX_STEPS,
  createOpenAICompatibleChatModel,
  type OpenAICompatibleModelOptions,
} from "./openai-compatible-runtime.js";

const TOOL_ORDER = ["search", "read", "update", "write", "bash"] as const;
const COMPACTION_RATIO = 0.7;
const RECENT_TOOL_MESSAGES_TO_KEEP = 5;

export type OpenAICompatibleCodingAgentOptions = OpenAICompatibleModelOptions & {
  readonly cwd: string;
  readonly maxSteps?: number;
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
  const toolBundle = createAiToolBundle(harness.registry, harness.context, approvalMode);
  const contextSize = options.contextSize ?? DEFAULT_CONTEXT_SIZE;

  const agent = new ToolLoopAgent({
    model: createOpenAICompatibleChatModel(options),
    instructions: CODING_INSTRUCTIONS,
    tools: toolBundle.tools,
    toolApproval: toolBundle.approvals,
    stopWhen: isStepCount(options.maxSteps ?? DEFAULT_MAX_STEPS),
    toolOrder: [...TOOL_ORDER],
    prepareStep: ({ stepNumber, steps, messages }) => {
      const failureHint = formatFailureHint(steps);
      const compactedMessages = shouldCompact(messages, contextSize)
        ? pruneMessages({
          messages,
          reasoning: "all",
          toolCalls: `before-last-${RECENT_TOOL_MESSAGES_TO_KEEP}-messages`,
          emptyMessages: "remove",
        })
        : undefined;

      return {
        toolOrder: [...TOOL_ORDER],
        temperature: stepNumber === 0 ? 0 : undefined,
        ...(failureHint === undefined ? {} : { instructions: `${CODING_INSTRUCTIONS}\n\n${failureHint}` }),
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

function shouldCompact(messages: readonly ModelMessage[], contextSize: number): boolean {
  return estimateTokens(messages) > contextSize * COMPACTION_RATIO;
}

function estimateTokens(messages: readonly ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

function formatFailureHint(steps: readonly unknown[]): string | undefined {
  const failures = latestToolFailures(steps);
  if (failures.length === 0) {
    return undefined;
  }

  return [
    "The previous tool call failed. Do not retry the same input unchanged.",
    ...failures.map((failure) => recoveryHint(failure)),
  ].join("\n");
}

function latestToolFailures(steps: readonly unknown[]): Array<{ readonly toolName: string; readonly code: string; readonly error: string }> {
  const lastStep = steps.at(-1) as { readonly toolResults?: readonly unknown[] } | undefined;
  const results = lastStep?.toolResults ?? [];
  const failures: Array<{ readonly toolName: string; readonly code: string; readonly error: string }> = [];

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

function recoveryHint(failure: { readonly toolName: string; readonly code: string; readonly error: string }): string {
  switch (failure.code) {
    case "PATH_NOT_FOUND":
      return `For ${failure.toolName}: ${failure.error}. Search or list the parent directory before reading.`;
    case "READ_RANGE_INVALID":
    case "UPDATE_RANGE_INVALID":
      return `For ${failure.toolName}: ${failure.error}. Re-read the file slice and use valid current line numbers.`;
    case "UPDATE_STALE_FILE":
    case "UPDATE_RANGE_CHANGED":
      return `For ${failure.toolName}: ${failure.error}. Re-read the target range and retry with fresh hashes.`;
    case "BASH_SPAWN_FAILED":
      return `For bash: ${failure.error}. Use a normal shell command string such as "npm run build" from the right cwd.`;
    case "BASH_TIMEOUT":
      return `For bash: ${failure.error}. Use a narrower command or increase timeoutMs if necessary.`;
    default:
      return `For ${failure.toolName}: ${failure.code}: ${failure.error}. Change strategy before retrying.`;
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
