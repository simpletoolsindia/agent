import { jsonSchema, tool, ToolLoopAgent, type Tool as AiSdkTool } from "ai";
import type { ToolContext } from "../core/tool.js";
import type { ToolRegistry } from "../core/registry.js";
import { createOpenAICompatibleChatModel, type OpenAICompatibleModelOptions } from "./openai-compatible-runtime.js";

const SUBAGENT_TOOL_ORDER = ["search", "read"] as const;
const MAX_SUBAGENT_SUMMARY_CHARS = 5000;
const MAX_SUBAGENT_SUMMARY_LINES = 80;

const SUBAGENT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["taskGoal"],
  properties: {
    role: {
      type: "string",
      enum: ["research", "review", "plan"],
      description: "Subagent mode. Default research. Use review for risks and plan for non-mutating implementation plans.",
    },
    taskGoal: {
      type: "string",
      minLength: 1,
      description: "Concrete research, review, or planning goal for the subagent.",
    },
    currentFolderPath: {
      type: "string",
      minLength: 1,
      description: "Workspace folder path. Optional; defaults to the active workspace.",
    },
    referenceFiles: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "reason"],
        properties: {
          path: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
        },
      },
      description: "Known files or directories to inspect first. Optional; the subagent can search when omitted.",
    },
    implementationSteps: {
      type: "array",
      items: { type: "string", minLength: 1 },
      description: "Optional focus steps for the subagent.",
    },
    validation: {
      type: "array",
      items: { type: "string", minLength: 1 },
      description: "Optional validation scenarios the main agent expects to run.",
    },
    expectedOutcome: {
      type: "string",
      minLength: 1,
      description: "Optional observable outcome expected from the main task.",
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
  readonly currentFolderPath?: string;
  readonly referenceFiles?: readonly SubagentReferenceFile[];
  readonly implementationSteps?: readonly string[];
  readonly validation?: readonly string[];
  readonly expectedOutcome?: string;
};

type SubagentOutput = {
  readonly role: "research" | "review" | "plan";
  readonly taskGoal: string;
  readonly summary: string;
  readonly summaryTruncated: boolean;
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
      "Delegate context-heavy research, review, or planning to a read-only subagent so the main agent keeps a small working context.",
      "Use this before reading many files yourself. Send one clear taskGoal plus any known referenceFiles, validation, and expectedOutcome.",
      "The subagent uses only search/read, returns a bounded evidence handoff, and the main agent validates before moving to the next task.",
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
          prompt: formatSubagentPrompt(parsed, context.pathPolicy.resolveInside(".")),
          abortSignal: executionOptions.abortSignal,
        });

        const summary = compactSubagentSummary(result.text);
        return {
          ok: true,
          output: {
            role,
            taskGoal: parsed.taskGoal,
            summary: summary.text,
            summaryTruncated: summary.truncated,
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

function formatSubagentPrompt(input: SubagentInput, workspaceRoot: string): string {
  const referenceFiles = input.referenceFiles ?? [];
  const implementationSteps = input.implementationSteps ?? ["Map only the relevant code or references", "Return a compact evidence handoff with exact paths/symbols", "Name risks, assumptions, and the smallest useful next action"];
  const validation = input.validation ?? ["Main agent validates the handoff before editing or moving to the next task"];
  const expectedOutcome = input.expectedOutcome ?? "A bounded summary the main agent can validate without importing broad context.";
  return [
    `# Task goal\n${input.taskGoal}`,
    `# Current folder path\n${input.currentFolderPath ?? workspaceRoot}`,
    `# Reference files\n${referenceFiles.length === 0 ? "- <none supplied; search first>" : referenceFiles.map((file) => `- ${file.path}: ${file.reason}`).join("\n")}`,
    `# Implementation steps\n${implementationSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    `# Validation\n${validation.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    `# Expected outcome\n${expectedOutcome}`,
  ].join("\n\n");
}

function compactSubagentSummary(text: string): { readonly text: string; readonly truncated: boolean } {
  const lines = text.split("\n");
  const lineLimited = lines.length > MAX_SUBAGENT_SUMMARY_LINES;
  const limitedLines = lineLimited ? lines.slice(0, MAX_SUBAGENT_SUMMARY_LINES) : lines;
  const joined = limitedLines.join("\n").trim();
  if (joined.length <= MAX_SUBAGENT_SUMMARY_CHARS) {
    return {
      text: lineLimited ? `${joined}\n\n[Subagent summary truncated to ${MAX_SUBAGENT_SUMMARY_LINES} lines.]` : joined,
      truncated: lineLimited,
    };
  }

  return {
    text: `${joined.slice(0, MAX_SUBAGENT_SUMMARY_CHARS).trimEnd()}\n\n[Subagent summary truncated to ${MAX_SUBAGENT_SUMMARY_CHARS} characters.]`,
    truncated: true,
  };
}

function subagentInstructions(role: SubagentOutput["role"]): string {
  const base = [
    "You are a read-only coding subagent running inside a TypeScript harness.",
    "Your job is to reduce the main agent's context load: inspect broad context, then return a compact handoff instead of raw exploration notes.",
    "Use only search and read. Never ask for approval. Never modify files. Never run commands.",
    "Search before reading unknown files. Prefer focused slices over full files.",
    "Do not request or suggest git commands for repository context; the main agent should use search and read.",
    "Do not paste full files. Quote only the smallest evidence lines needed to justify the handoff.",
    "Evaluate plans against clean-code readability and SOLID boundaries: single responsibility, narrow interfaces, substitutable contracts, and dependency inversion.",
    "Final answer contract: <=80 lines and <=5000 characters; include exact paths/symbols, evidence, risks, validation ideas, and the next action for the main agent.",
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
