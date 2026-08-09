import { jsonSchema, tool, type Tool as AiSdkTool } from "ai";

export type TodoItemStatus = "pending" | "in_progress" | "done" | "blocked";

type TodoItem = {
  readonly task: string;
  readonly status: TodoItemStatus;
};

type TodoPhase = {
  readonly phase: string;
  readonly items: readonly TodoItem[];
};

type TodoInput = unknown;

export type TodoOutput = {
  readonly phases: readonly TodoPhase[];
  readonly current?: string;
  readonly pending: number;
  readonly done: number;
  readonly total: number;
  readonly fallback?: boolean;
};

const TODO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    phases: { type: "array" },
    list: {},
    items: {},
    tasks: {},
    todos: {},
    todo: {},
    text: { type: "string" },
    plan: { type: "string" },
    current: { type: "string" },
  },
} as const;

const FALLBACK_TASK = "Continue requested work";
const DEFAULT_PHASE = "Todo";
const MAX_PHASES = 8;
const MAX_ITEMS_PER_PHASE = 12;
const MAX_PHASE_LENGTH = 60;
const MAX_TASK_LENGTH = 120;

/** Creates a session-local todo tool so the TUI can show current and pending work. */
export function createTodoTool(): AiSdkTool {
  let latest: TodoOutput = { phases: [], pending: 0, done: 0, total: 0 };

  return tool({
    title: "Show todo plan",
    description: "Show the user a live todo list. Preferred input is { phases: [{ phase, items: [{ task, status }] }] }, but fallback inputs like { tasks: [string] }, { todo: string }, or { text: string } are accepted and normalized.",
    inputSchema: jsonSchema(TODO_INPUT_SCHEMA as never),
    strict: false,
    execute: async (input: TodoInput): Promise<TodoOutput> => {
      const normalized = normalizeTodoInput(input, latest);
      latest = normalized;
      return latest;
    },
  });
}

export function normalizeTodoInput(input: TodoInput, previous?: TodoOutput): TodoOutput {
  const phases = normalizePhases(readRawPhases(input))
    ?? normalizeTaskList(DEFAULT_PHASE, readRawTaskList(input))
    ?? normalizeTextPlan(readRawText(input))
    ?? previous?.phases;

  if (phases !== undefined && phases.length > 0) {
    return summarizeTodos(ensureSingleActive(phases), false);
  }

  return summarizeTodos([{ phase: DEFAULT_PHASE, items: [{ task: FALLBACK_TASK, status: "in_progress" }] }], true);
}

export function summarizeTodos(phases: readonly TodoPhase[], fallback = false): TodoOutput {
  let pending = 0;
  let done = 0;
  let total = 0;
  let current: string | undefined;

  for (const phase of phases) {
    for (const item of phase.items) {
      total += 1;
      if (item.status === "done") {
        done += 1;
      } else {
        pending += 1;
      }
      if (current === undefined && item.status === "in_progress") {
        current = `${phase.phase}: ${item.task}`;
      }
    }
  }

  return {
    phases,
    ...(current === undefined ? {} : { current }),
    pending,
    done,
    total,
    ...(fallback ? { fallback: true } : {}),
  };
}

function readRawPhases(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (Array.isArray(record.phases)) {
    return record.phases;
  }
  if (Array.isArray(record.list) && record.list.some(isPhaseLike)) {
    return record.list;
  }
  return undefined;
}

function readRawTaskList(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  if (Array.isArray(record.tasks)) return record.tasks;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.todos)) return record.todos;
  if (Array.isArray(record.list)) return record.list;
  return undefined;
}

function readRawText(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  for (const key of ["todo", "todos", "tasks", "items", "list", "plan", "text", "current"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function normalizePhases(raw: unknown): TodoPhase[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const phases = raw.slice(0, MAX_PHASES).flatMap((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const items = normalizeTaskItems(Array.isArray(record.items) ? record.items : Array.isArray(record.tasks) ? record.tasks : undefined);
    if (items.length === 0) {
      return [];
    }
    return [{
      phase: cleanLabel(readString(record.phase) ?? readString(record.name) ?? readString(record.title) ?? `Phase ${index + 1}`, MAX_PHASE_LENGTH),
      items,
    }];
  });
  return phases.length === 0 ? undefined : phases;
}

function normalizeTaskList(phase: string, raw: unknown): TodoPhase[] | undefined {
  const items = normalizeTaskItems(raw);
  return items.length === 0 ? undefined : [{ phase, items }];
}

function normalizeTaskItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.slice(0, MAX_ITEMS_PER_PHASE).flatMap((entry) => {
    const item = normalizeTaskItem(entry);
    return item === undefined ? [] : [item];
  });
}

function normalizeTaskItem(entry: unknown): TodoItem | undefined {
  if (typeof entry === "string") {
    const parsed = parseTaskLine(entry);
    return parsed === undefined ? undefined : { task: parsed.task, status: parsed.status ?? "pending" };
  }
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const task = readString(record.task) ?? readString(record.text) ?? readString(record.title) ?? readString(record.name);
  if (task === undefined) {
    return undefined;
  }
  return {
    task: cleanLabel(task, MAX_TASK_LENGTH),
    status: normalizeStatus(record.status, record.done === true || record.completed === true),
  };
}

function normalizeTextPlan(raw: string | undefined): TodoPhase[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const items = raw
    .split(/\r?\n/)
    .flatMap((line) => {
      const parsed = parseTaskLine(line);
      return parsed === undefined ? [] : [{ task: parsed.task, status: parsed.status ?? "pending" }];
    })
    .slice(0, MAX_ITEMS_PER_PHASE);
  return items.length === 0 ? undefined : [{ phase: DEFAULT_PHASE, items }];
}

function parseTaskLine(line: string): { readonly task: string; readonly status?: TodoItemStatus } | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let status: TodoItemStatus | undefined;
  let task = trimmed;
  if (/^\[[xX]\]\s+/.test(task) || /^done\s*[:\-]\s*/i.test(task)) {
    status = "done";
  } else if (/^\[[!]\]\s+/.test(task) || /^blocked\s*[:\-]\s*/i.test(task)) {
    status = "blocked";
  } else if (/^\[[>]\]\s+/.test(task) || /^(current|active|in[-_ ]progress)\s*[:\-]\s*/i.test(task)) {
    status = "in_progress";
  }
  task = task
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[[ xX!>]\]\s+/, "")
    .replace(/^(done|blocked|current|active|in[-_ ]progress)\s*[:\-]\s*/i, "");
  const cleaned = cleanLabel(task, MAX_TASK_LENGTH);
  return cleaned.length === 0 ? undefined : { task: cleaned, ...(status === undefined ? {} : { status }) };
}

function ensureSingleActive(phases: readonly TodoPhase[]): TodoPhase[] {
  let foundActive = false;
  let firstOpen: { phaseIndex: number; itemIndex: number } | undefined;
  const normalized = phases.map((phase, phaseIndex) => ({
    phase: phase.phase,
    items: phase.items.map((item, itemIndex) => {
      if (firstOpen === undefined && item.status !== "done" && item.status !== "blocked") {
        firstOpen = { phaseIndex, itemIndex };
      }
      if (item.status !== "in_progress") {
        return item;
      }
      if (foundActive) {
        return { ...item, status: "pending" as const };
      }
      foundActive = true;
      return item;
    }),
  }));

  if (foundActive || firstOpen === undefined) {
    return normalized;
  }
  const target = firstOpen;

  return normalized.map((phase, phaseIndex) => ({
    phase: phase.phase,
    items: phase.items.map((item, itemIndex) => (
      phaseIndex === target.phaseIndex && itemIndex === target.itemIndex
        ? { ...item, status: "in_progress" as const }
        : item
    )),
  }));
}

function normalizeStatus(status: unknown, done: boolean): TodoItemStatus {
  if (done) {
    return "done";
  }
  if (typeof status !== "string") {
    return "pending";
  }
  const normalized = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "done" || normalized === "complete" || normalized === "completed") return "done";
  if (normalized === "in_progress" || normalized === "active" || normalized === "current" || normalized === "doing") return "in_progress";
  if (normalized === "blocked" || normalized === "waiting") return "blocked";
  return "pending";
}

function isPhaseLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Array.isArray(record.items) || Array.isArray(record.tasks);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function cleanLabel(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
