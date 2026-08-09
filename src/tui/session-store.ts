import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelMessage } from "ai";

const MAX_SESSIONS = 5;
const STORE_DIR = join(homedir(), ".harness-tools");
const STORE_PATH = join(STORE_DIR, "sessions.json");

export type HarnessSession = {
  readonly id: string;
  readonly cwd: string;
  readonly model: string;
  readonly updatedAt: string;
  readonly messages: readonly ModelMessage[];
};

type SessionFile = {
  readonly sessions: readonly HarnessSession[];
};

export async function listSessions(): Promise<readonly HarnessSession[]> {
  return (await readStore()).sessions;
}

export async function loadSession(id: string | undefined, cwd: string): Promise<HarnessSession | undefined> {
  const sessions = await listSessions();
  if (id !== undefined && id.trim().length > 0) {
    return sessions.find((session) => session.id === id.trim());
  }
  return sessions.find((session) => session.cwd === cwd) ?? sessions[0];
}

export async function saveSession(input: {
  readonly id?: string;
  readonly cwd: string;
  readonly model: string;
  readonly messages: readonly ModelMessage[];
}): Promise<HarnessSession> {
  const id = normalizedSessionId(input.id, input.cwd);
  const nextSession: HarnessSession = {
    id,
    cwd: input.cwd,
    model: input.model,
    updatedAt: new Date().toISOString(),
    messages: input.messages,
  };
  const existing = await listSessions();
  const sessions = [
    nextSession,
    ...existing.filter((session) => session.id !== id),
  ].slice(0, MAX_SESSIONS);
  await writeStore({ sessions });
  return nextSession;
}

export function formatSessionList(sessions: readonly HarnessSession[]): string {
  if (sessions.length === 0) {
    return "No saved sessions.";
  }
  return [
    "Saved sessions:",
    ...sessions.map((session, index) => `${index + 1}. ${session.id} · ${session.model} · ${session.cwd} · ${session.updatedAt} · ${session.messages.length} messages`),
  ].join("\n");
}

function normalizedSessionId(id: string | undefined, cwd: string): string {
  const trimmed = id?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }
  return cwd.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(-48) || "default";
}

async function readStore(): Promise<SessionFile> {
  try {
    const text = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(text) as Partial<SessionFile>;
    return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter(isHarnessSession).slice(0, MAX_SESSIONS) : [] };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { sessions: [] };
    }
    throw error;
  }
}

async function writeStore(store: SessionFile): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function isHarnessSession(value: unknown): value is HarnessSession {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.cwd === "string"
    && typeof record.model === "string"
    && typeof record.updatedAt === "string"
    && Array.isArray(record.messages);
}
