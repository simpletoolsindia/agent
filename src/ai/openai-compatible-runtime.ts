import { createOpenAI } from "@ai-sdk/openai";

export type OpenAICompatibleModelOptions = {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly providerName?: string;
};

export const DEFAULT_MAX_STEPS = 20;

export const CODING_INSTRUCTIONS = [
  "You are a precise coding harness using exactly five tools: search, bash, write, update, read.",
  "Use search before read when locating unknown code.",
  "Use read before update, then pass the fresh fileHash and rangeHash to update.",
  "Prefer update for existing files and write for new files or intentional full replacement.",
  "Use bash only for focused verification commands.",
  "When a tool returns ok=false, read the code/details, recover with a different action, and continue the loop.",
  "For PATH_NOT_FOUND, search or list the parent directory instead of stopping.",
  "For BASH_SPAWN_FAILED, fix the executable name or use an absolute path instead of retrying unchanged.",
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
