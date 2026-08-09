import { jsonSchema, tool, ToolLoopAgent, type Tool as AiSdkTool } from "ai";
import type { ToolContext } from "../core/tool.js";
import type { ToolRegistry } from "../core/registry.js";
import { createOpenAICompatibleChatModel, type OpenAICompatibleModelOptions } from "./openai-compatible-runtime.js";

const SUBAGENT_TOOL_ORDER = ["search", "read"] as const;

const SUBAGENT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["task"],
  properties: {
    task: {
      type: "string",
      minLength: 1,
      description: "Focused task for the subagent. Include scope, files/directories, and expected summary format.",
    },
    role: {
      type: "string",
      enum: ["research", "review", "plan"],
      description: "Subagent mode. research maps code, review critiques evidence, plan returns a non-mutating implementation plan.",
    },
  },
} as const;

type SubagentInput = {
  readonly task: string;
  readonly role?: "research" | "review" | "plan";
};

type SubagentOutput = {
  readonly role: "research" | "review" | "plan";
  readonly task: string;
  readonly summary: string;
  readonly elapsedMs: number;
};

export type SubagentToolOptions = OpenAICompatibleModelOptions;

export function createSubagentTool(
  registry: ToolRegistry,
  context: ToolContext,
  options: SubagentToolOptions,
): AiSdkTool {
  return tool({
    title: "Subagent · Context offload",
    metadata: { safety: "read-only" },
    description: [
      "Delegate context-heavy codebase research, review, or planning to a read-only subagent.",
      "Use it for broad exploration before editing, parallelizable investigation, or keeping the main context clean.",
      "The subagent can use only search and read, then returns a concise summary with evidence.",
    ].join(" "),
    inputSchema: jsonSchema(SUBAGENT_INPUT_SCHEMA as never),
    strict: true,
    execute: async (input: unknown, executionOptions: { readonly abortSignal?: AbortSignal } = {}) => {
      const started = performance.now();
      const parsed = input as SubagentInput;
      const role = parsed.role ?? "research";

      try {
        const result = await new ToolLoopAgent({
          model: createOpenAICompatibleChatModel(options),
          instructions: subagentInstructions(role),
          tools: {
            search: readonlyRegistryTool("search", registry, context),
            read: readonlyRegistryTool("read", registry, context),
          },
          toolOrder: [...SUBAGENT_TOOL_ORDER],
          temperature: 0,
        }).generate({
          prompt: parsed.task,
          abortSignal: executionOptions.abortSignal,
        });

        return {
          ok: true,
          output: {
            role,
            task: parsed.task,
            summary: result.text,
            elapsedMs: performance.now() - started,
          } satisfies SubagentOutput,
          elapsedMs: performance.now() - started,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          code: "SUBAGENT_FAILED",
          elapsedMs: performance.now() - started,
        };
      }
    },
  });
}

function readonlyRegistryTool(name: "search" | "read", registry: ToolRegistry, context: ToolContext): AiSdkTool {
  const schema = name === "search"
    ? {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 },
        maxMatches: { type: "integer", minimum: 1, maximum: 1000 },
        literal: { type: "boolean" },
        caseSensitive: { type: "boolean" },
        glob: { type: "string", minLength: 1 },
      },
    }
    : {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1 },
        startLine: { type: "integer", minimum: 1 },
        limitLines: { type: "integer", minimum: 1, maximum: 2000 },
      },
    };

  return tool({
    title: name === "search" ? "Subagent search" : "Subagent read",
    metadata: { safety: "read-only" },
    description: name === "search"
      ? "Search workspace files with ripgrep. Use before reading unknown files."
      : "Read file slices or list directories inside the workspace.",
    inputSchema: jsonSchema(schema as never),
    strict: true,
    execute: async (input: unknown) => registry.run(name, input, context),
  });
}

function subagentInstructions(role: SubagentOutput["role"]): string {
  const base = [
    "You are a read-only coding subagent running inside a TypeScript harness.",
    "Use only search and read. Never ask for approval. Never modify files. Never run commands.",
    "Search before reading unknown files. Prefer focused slices over full files.",
    "Your final answer is returned to the main agent; include exact paths, symbols, and evidence.",
  ];

  if (role === "review") {
    return [
      ...base,
      "Review mode: identify concrete risks, bugs, regressions, and missing verification. Separate evidence from inference.",
    ].join("\n");
  }

  if (role === "plan") {
    return [
      ...base,
      "Plan mode: produce a non-mutating implementation plan with affected files, dependencies, risks, and verification steps.",
    ].join("\n");
  }

  return [
    ...base,
    "Research mode: map the relevant code quickly, summarize the current design, and name the smallest useful next action.",
  ].join("\n");
}
