import { jsonSchema, tool, ToolLoopAgent, type Tool as AiSdkTool } from "ai";
import type { ToolContext } from "../core/tool.js";
import type { ToolRegistry } from "../core/registry.js";
import { createOpenAICompatibleChatModel, type OpenAICompatibleModelOptions } from "./openai-compatible-runtime.js";

const SUBAGENT_TOOL_ORDER = ["search", "read"] as const;

const SUBAGENT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["taskGoal", "currentFolderPath", "referenceFiles", "implementationSteps", "validation", "expectedOutcome"],
  properties: {
    role: {
      type: "string",
      enum: ["research", "review", "plan"],
      description: "Subagent mode. research maps code, review critiques evidence, plan returns a non-mutating implementation plan.",
    },
    taskGoal: {
      type: "string",
      minLength: 1,
      description: "Concrete goal for this single sequential task.",
    },
    currentFolderPath: {
      type: "string",
      minLength: 1,
      description: "Current workspace folder path supplied by the main agent.",
    },
    referenceFiles: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "reason"],
        properties: {
          path: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
        },
      },
      description: "Files or existing logic/patterns the subagent should inspect before answering.",
    },
    implementationSteps: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
      description: "Ordered steps the main agent expects for this task.",
    },
    validation: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
      description: "Focused validation commands or scenarios the main agent must run after this task.",
    },
    expectedOutcome: {
      type: "string",
      minLength: 1,
      description: "Observable outcome that proves this task is complete.",
    },
  },
} as const;

type SubagentReferenceFile = {
  readonly path: string;
  readonly reason: string;
};

type SubagentInput = {
  readonly role?: "research" | "review" | "plan";
  readonly taskGoal: string;
  readonly currentFolderPath: string;
  readonly referenceFiles: readonly SubagentReferenceFile[];
  readonly implementationSteps: readonly string[];
  readonly validation: readonly string[];
  readonly expectedOutcome: string;
};

type SubagentOutput = {
  readonly role: "research" | "review" | "plan";
  readonly taskGoal: string;
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
      "Delegate one detailed sequential task to a read-only subagent for research, review, or planning.",
      "The main agent must include the current folder path, reference files, implementation steps, validation steps, and expected outcome.",
      "The subagent can use only search and read, then returns a concise summary with evidence for the main agent to validate.",
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
          prompt: formatSubagentPrompt(parsed),
          abortSignal: executionOptions.abortSignal,
        });

        return {
          ok: true,
          output: {
            role,
            taskGoal: parsed.taskGoal,
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

function formatSubagentPrompt(input: SubagentInput): string {
  return [
    `# Task goal\n${input.taskGoal}`,
    `# Current folder path\n${input.currentFolderPath}`,
    `# Reference files\n${input.referenceFiles.map((file) => `- ${file.path}: ${file.reason}`).join("\n")}`,
    `# Implementation steps\n${input.implementationSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    `# Validation\n${input.validation.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    `# Expected outcome\n${input.expectedOutcome}`,
  ].join("\n\n");
}

function subagentInstructions(role: SubagentOutput["role"]): string {
  const base = [
    "You are a read-only coding subagent running inside a TypeScript harness.",
    "Use only search and read. Never ask for approval. Never modify files. Never run commands.",
    "Search before reading unknown files. Prefer focused slices over full files.",
    "Do not request or suggest git commands for repository context; the main agent should use search and read.",
    "Evaluate plans against clean-code readability and SOLID boundaries: single responsibility, narrow interfaces, substitutable contracts, and dependency inversion.",
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
