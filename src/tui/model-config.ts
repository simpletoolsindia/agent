import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ApprovalMode } from "../ai/ai-tools.js";
import type { OpenAICompatibleCodingAgentOptions } from "../ai/coding-agent.js";

export type ModelConfig = {
  readonly model?: string;
  readonly baseURL?: string;
  readonly apiKey?: string;
  readonly providerName?: string;
  readonly approvalMode?: ApprovalMode;
  readonly agentMdPath?: string;
  readonly skillsMdPath?: string;
  readonly contextSize?: number;
  readonly updatedAt?: string;
};

const CONFIG_DIR = process.env.HARNESS_CONFIG_DIR ?? join(homedir(), ".harness-tools");
export const MODEL_CONFIG_PATH = process.env.HARNESS_MODEL_CONFIG_PATH ?? join(CONFIG_DIR, "model.json");

export async function loadModelConfig(path: string = MODEL_CONFIG_PATH): Promise<ModelConfig | undefined> {
  try {
    return parseModelConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function saveModelConfig(options: OpenAICompatibleCodingAgentOptions, path: string = MODEL_CONFIG_PATH): Promise<ModelConfig> {
  const config: ModelConfig = stripEmptyConfig({
    model: options.model,
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    providerName: options.providerName,
    approvalMode: options.approvalMode,
    agentMdPath: options.agentMdPath,
    skillsMdPath: options.skillsMdPath,
    contextSize: options.contextSize,
    updatedAt: new Date().toISOString(),
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export function applyModelConfig<T extends OpenAICompatibleCodingAgentOptions>(options: T, config: ModelConfig | undefined): T {
  if (config === undefined) {
    return options;
  }
  return {
    ...options,
    model: config.model ?? options.model,
    baseURL: config.baseURL ?? options.baseURL,
    apiKey: config.apiKey ?? options.apiKey,
    providerName: config.providerName ?? options.providerName,
    approvalMode: config.approvalMode ?? options.approvalMode,
    agentMdPath: config.agentMdPath ?? options.agentMdPath,
    skillsMdPath: config.skillsMdPath ?? options.skillsMdPath,
    contextSize: config.contextSize ?? options.contextSize,
  };
}

function parseModelConfig(value: unknown): ModelConfig | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const approvalMode = readApprovalMode(record.approvalMode);
  return stripEmptyConfig({
    model: readString(record.model),
    baseURL: readString(record.baseURL),
    apiKey: readString(record.apiKey),
    providerName: readString(record.providerName),
    approvalMode,
    agentMdPath: readString(record.agentMdPath),
    skillsMdPath: readString(record.skillsMdPath),
    contextSize: readPositiveInteger(record.contextSize),
    updatedAt: readString(record.updatedAt),
  });
}

function stripEmptyConfig(config: ModelConfig): ModelConfig {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined && value !== "")) as ModelConfig;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readApprovalMode(value: unknown): ApprovalMode | undefined {
  return value === "safe" || value === "auto" ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

