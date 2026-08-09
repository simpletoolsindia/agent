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
  "Completion contract: do not return a final answer until every user-requested item is implemented, affected docs are updated, focused verification has passed, and the todo list reflects the final state or an external blocker is explicitly named.",
  "If work remains after any tool result, continue with the next concrete tool call instead of summarizing progress.",
  "Keep the main context small: use subagent for broad discovery/review/planning, consume only its compact handoff, then validate the claim yourself before editing or moving on.",
  "Use search before read when locating unknown code.",
  "Use read before update, then pass the fresh fileHash and rangeHash to update.",
  "Prefer update for existing files and write for new files or intentional full replacement.",
  "Use bash only for focused verification commands; pass a normal shell command string.",
  "When several read-only or verification tool calls are independent, request them together in one step; the AI SDK executes same-step tools in parallel.",
  "Do not run git commands to collect repository context for the LLM; use search and read instead.",
  "When bash returns a non-zero exitCode, inspect stdout/stderr and fix the command or code.",
  "When a tool returns ok=false, read the code/details, recover with a different action, and continue the loop.",
  "For small models, recovery must be explicit: classify the failure, avoid repeating the same call, choose the listed recovery action, and continue the loop.",
  "A failed tool or subagent result must never end the agent loop by itself; only verified completion or a real external blocker can stop the loop.",
  "For PATH_NOT_FOUND, search or list the parent directory instead of stopping.",
  "Use subagent immediately for broad codebase research, unfamiliar UI flows, reviews, or non-mutating plans when the task touches multiple files or you would otherwise read many files.",
  "When work is running, the TUI lets the user press Esc/Ctrl+C to interrupt the current stream, abort any active subagent, and type the next instruction immediately; treat SUBAGENT_ABORTED as recoverable feedback.",
  "Subagent can be called with a concise task goal and optional reference files; do not avoid it because the task is not fully mapped yet.",
  "Clean-code target: optimize for readable, maintainable TypeScript with clear names, narrow modules, explicit data contracts, low coupling, and SOLID principles.",
  "Prefer boring module-local functions and interfaces over unnecessary abstractions; add abstractions only when they reduce real coupling or protect invariants.",
] as const;

const TASK_WORKFLOW_INSTRUCTIONS = [
  "Subagent loop for non-trivial tasks: user input -> analyze the request/project -> create a sequential todo list -> delegate the next context-heavy task -> validate the subagent handoff -> edit or re-delegate if the handoff is wrong -> verify the task -> mark todo state -> continue.",
  "Before changing code for a non-trivial user task, the main agent must analyze the request and create a detailed sequential task list.",
  "Each task entry must include: task goal, current folder path, reference files or existing logic/patterns, implementation steps, validation steps, and expected outcome.",
  "Run tasks one by one when they depend on each other. For each delegated task, give subagent a clear taskGoal, known references, validation expectations, expected outcome, and clean-code/SOLID constraints.",
  "Validation belongs to the main agent: inspect the subagent result, run the focused command or scenario named in the task, confirm it passes, and fix or re-delegate failures before starting another task.",
  "If a subagent result is incomplete, stale, or conflicts with observed code, do not accept it; create a narrower follow-up subagent task or correct the issue directly before continuing.",
  "After all tasks pass, validate the overall outcome, summarize changes and evidence to the user, and leave todo state completed.",
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
