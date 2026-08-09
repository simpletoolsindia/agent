import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { InstructionDocument } from "./openai-compatible-runtime.js";

const MAX_CONTEXT_FILE_BYTES = 64 * 1024;

export type ContextFileOptions = {
  readonly agentMdPath?: string;
  readonly skillsMdPath?: string;
};

/** Loads optional markdown context files while keeping path handling out of agent setup. */
export function loadInstructionDocuments(cwd: string, options: ContextFileOptions): InstructionDocument[] {
  return [
    loadOptionalDocument(cwd, "agent.md", options.agentMdPath),
    loadOptionalDocument(cwd, "skills.md", options.skillsMdPath),
  ].filter((document): document is InstructionDocument => document !== undefined);
}

function loadOptionalDocument(cwd: string, title: string, requestedPath: string | undefined): InstructionDocument | undefined {
  if (requestedPath === undefined) {
    return undefined;
  }

  const path = resolveInside(cwd, requestedPath);
  if (!existsSync(path)) {
    throw new Error(`${title} context file does not exist: ${requestedPath}`);
  }

  const stats = statSync(path);
  if (!stats.isFile()) {
    throw new Error(`${title} context path is not a file: ${requestedPath}`);
  }
  if (stats.size > MAX_CONTEXT_FILE_BYTES) {
    throw new Error(`${title} context file exceeds ${MAX_CONTEXT_FILE_BYTES} bytes: ${requestedPath}`);
  }

  return {
    title,
    path,
    content: readFileSync(path, "utf8"),
  };
}

function resolveInside(cwd: string, requestedPath: string): string {
  const root = resolve(cwd);
  const resolved = resolve(root, requestedPath);
  const offset = relative(root, resolved);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error(`Context file path escapes workspace: ${requestedPath}`);
  }

  return resolved;
}
