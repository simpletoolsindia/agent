import { createOpenAI } from "@ai-sdk/openai";

export type OpenAICompatibleModelOptions = {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly providerName?: string;
};

export type InstructionDocument = {
  readonly title: string;
  readonly path: string;
  readonly content: string;
};


export const DEFAULT_CONTEXT_SIZE = 32768;


const BASE_CODING_INSTRUCTIONS = [
  "You are a precise coding harness using five workspace tools: search, bash, write, update, read, plus one read-only subagent tool for context-heavy research.",
  "Use search before read when locating unknown code.",
  "Use read before update, then pass the fresh fileHash and rangeHash to update.",
  "Prefer update for existing files and write for new files or intentional full replacement.",
  "Use bash only for focused verification commands; pass a normal shell command string.",
  "Do not run git commands to collect repository context for the LLM; use search and read instead.",
  "When bash returns a non-zero exitCode, inspect stdout/stderr and fix the command or code.",
  "When a tool returns ok=false, read the code/details, recover with a different action, and continue the loop.",
  "For PATH_NOT_FOUND, search or list the parent directory instead of stopping.",
  "Use subagent for broad codebase research, reviews, or non-mutating plans when the main context would get noisy.",
  "Clean-code target: optimize for readable, maintainable TypeScript with clear names, narrow modules, explicit data contracts, low coupling, and SOLID principles.",
  "Prefer boring module-local functions and interfaces over unnecessary abstractions; add abstractions only when they reduce real coupling or protect invariants.",
] as const;

const TASK_WORKFLOW_INSTRUCTIONS = [
  "Before changing code for a non-trivial user task, the main agent must analyze the request and create a detailed sequential task list.",
  "Each task entry must include: task goal, current folder path, reference files or existing logic/patterns, implementation steps, validation steps, and expected outcome.",
  "Delegate at most one task to subagent at a time. Wait for that result, validate the completed task, then continue with the next task.",
  "Validation belongs to the main agent: run the focused command or scenario named in the task, confirm it passes, and fix failures before starting another task.",
  "Every task plan and implementation must state how it preserves clean code, readability, and SOLID boundaries.",
] as const;

export function createCodingInstructions(cwd: string, documents: readonly InstructionDocument[] = []): string {
  return [
    ...BASE_CODING_INSTRUCTIONS,
    `Current folder path: ${cwd}`,
    ...formatInstructionDocuments(documents),
    ...TASK_WORKFLOW_INSTRUCTIONS,
  ].join("\n");
}

function formatInstructionDocuments(documents: readonly InstructionDocument[]): string[] {
  if (documents.length === 0) {
    return [];
  }

  return documents.flatMap((document) => [
    `Additional context from ${document.title}: ${document.path}`,
    document.content,
  ]);
}

/** Builds the chat model once per run while keeping provider setup out of runners. */
export function createOpenAICompatibleChatModel(options: OpenAICompatibleModelOptions) {
  const provider = createOpenAI({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.providerName === undefined ? {} : { name: options.providerName }),
  });

  return provider.chat(options.model);
}
