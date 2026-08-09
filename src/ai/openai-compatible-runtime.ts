import { createOpenAI } from "@ai-sdk/openai";

export type OpenAICompatibleModelOptions = {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly providerName?: string;
};

export const DEFAULT_CONTEXT_SIZE = 32768;


export const CODING_INSTRUCTIONS = [
  "You are a precise coding harness using five workspace tools: search, bash, write, update, read, plus one read-only subagent tool for context-heavy research.",
  "Use search before read when locating unknown code.",
  "Use read before update, then pass the fresh fileHash and rangeHash to update.",
  "Prefer update for existing files and write for new files or intentional full replacement.",
  "Use bash only for focused verification commands; pass a normal shell command string.",
  "When bash returns a non-zero exitCode, inspect stdout/stderr and fix the command or code.",
  "When a tool returns ok=false, read the code/details, recover with a different action, and continue the loop.",
  "For PATH_NOT_FOUND, search or list the parent directory instead of stopping.",
  "Use subagent for broad codebase research, reviews, or non-mutating plans when the main context would get noisy.",
].join("\n");

/** Builds the chat model once per run while keeping provider setup out of runners. */
export function createOpenAICompatibleChatModel(options: OpenAICompatibleModelOptions) {
  const provider = createOpenAI({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.providerName === undefined ? {} : { name: options.providerName }),
  });

  return provider.chat(options.model);
}
