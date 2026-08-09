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
type UnknownFields = { readonly [key: string]: unknown };
type TaskLocation = { readonly phaseIndex: number; readonly itemIndex: number };
type ParsedTaskLine = { readonly task: string; readonly status?: TodoItemStatus };

export type TodoOutput = {
  readonly phases: readonly TodoPhase[];
  readonly current?: string;
  readonly pending: number;
  readonly done: number;
  readonly total: number;
  readonly fallback?: boolean;
};

/**
 * Deliberately permissive: small/local models often miss the exact nested
 * shape, but a visible plan is still better than no plan. The executor below
 * owns validation, coercion, length limits, and a safe default.
 */
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

const TASK_ARRAY_KEYS = ["tasks", "items", "todos", "list"] as const;
const TEXT_PLAN_KEYS = ["todo", "todos", "tasks", "items", "list", "plan", "text", "current"] as const;
const TASK_TEXT_KEYS = ["task", "text", "title", "name"] as const;
const PHASE_NAME_KEYS = ["phase", "name", "title"] as const;

/** Creates a session-local todo tool so the TUI can show current and pending work. */
export function createTodoTool(): AiSdkTool {
  let latest: TodoOutput = { phases: [], pending: 0, done: 0, total: 0 };

  return tool({
    title: "Show todo plan",
    description: "Show the user a live todo list. Preferred input is { phases: [{ phase, items: [{ task, status }] }] }, but fallback inputs like { tasks: [string] }, { todo: string }, or { text: string } are accepted and normalized.",
    inputSchema: jsonSchema(TODO_INPUT_SCHEMA as never),
    strict: false,
    execute: async (input: TodoInput): Promise<TodoOutput> => {
      latest = normalizeTodoInput(input, latest);
      return latest;
    },
  });
}

/**
 * Normalization pipeline:
 * 1. Prefer the rich phased shape.
 * 2. Accept flat task arrays from common weak-model outputs.
 * 3. Parse markdown-ish text plans.
 * 4. Reuse the last valid plan when an update omits structure.
 * 5. Fall back to one active task so the UI never disappears.
 */
export function normalizeTodoInput(input: TodoInput, previous?: TodoOutput): TodoOutput {
  const phases = readPhasedPlan(input)
    ?? readFlatTaskPlan(input)
    ?? readTextPlan(input)
    ?? previous?.phases;

  if (phases !== undefined && phases.length > 0) {
    return summarizeTodos(ensureSingleActive(phases));
  }

  return summarizeTodos([{ phase: DEFAULT_PHASE, items: [{ task: FALLBACK_TASK, status: "in_progress" }] }], true);
}

export function summarizeTodos(phases: readonly TodoPhase[], fallback = false): TodoOutput {
  const totals = countTodoItems(phases);
  const current = findActiveTask(phases);

  return {
    phases,
    ...(current === undefined ? {} : { current }),
    pending: totals.pending,
    done: totals.done,
    total: totals.total,
    ...(fallback ? { fallback: true } : {}),
  };
}

function readPhasedPlan(input: unknown): TodoPhase[] | undefined {
  const fields = objectFields(input);
  if (fields === undefined) {
    return undefined;
  }
  if (Array.isArray(fields.phases)) {
    return normalizePhases(fields.phases);
  }
  if (Array.isArray(fields.list) && fields.list.some(hasTaskArray)) {
    return normalizePhases(fields.list);
  }
  return undefined;
}

function readFlatTaskPlan(input: unknown): TodoPhase[] | undefined {
  const fields = objectFields(input);
  if (fields === undefined) {
    return undefined;
  }
  for (const key of TASK_ARRAY_KEYS) {
    if (Array.isArray(fields[key])) {
      return normalizeTaskList(DEFAULT_PHASE, fields[key]);
    }
  }
  return undefined;
}

function readTextPlan(input: unknown): TodoPhase[] | undefined {
  if (typeof input === "string") {
    return normalizeTextPlan(input);
  }
  const fields = objectFields(input);
  if (fields === undefined) {
    return undefined;
  }
  for (const key of TEXT_PLAN_KEYS) {
    const value = fields[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return normalizeTextPlan(value);
    }
  }
  return undefined;
}

function normalizePhases(rawPhases: readonly unknown[]): TodoPhase[] | undefined {
  const phases = rawPhases.slice(0, MAX_PHASES).flatMap((entry, index) => {
    const fields = objectFields(entry);
    if (fields === undefined) {
      return [];
    }

    const items = normalizeTaskItems(readTaskArray(fields));
    if (items.length === 0) {
      return [];
    }

    return [{
      phase: readFirstString(fields, PHASE_NAME_KEYS, `Phase ${index + 1}`, MAX_PHASE_LENGTH) ?? `Phase ${index + 1}`,
      items,
    }];
  });

  return phases.length === 0 ? undefined : phases;
}

function normalizeTaskList(phase: string, rawItems: readonly unknown[]): TodoPhase[] | undefined {
  const items = normalizeTaskItems(rawItems);
  return items.length === 0 ? undefined : [{ phase, items }];
}

function normalizeTaskItems(rawItems: readonly unknown[] | undefined): TodoItem[] {
  if (rawItems === undefined) {
    return [];
  }

  return rawItems.slice(0, MAX_ITEMS_PER_PHASE).flatMap((entry) => {
    const item = normalizeTaskItem(entry);
    return item === undefined ? [] : [item];
  });
}

function normalizeTaskItem(entry: unknown): TodoItem | undefined {
  if (typeof entry === "string") {
    const parsed = parseTaskLine(entry);
    return parsed === undefined ? undefined : { task: parsed.task, status: parsed.status ?? "pending" };
  }

  const fields = objectFields(entry);
  if (fields === undefined) {
    return undefined;
  }

  const task = readFirstString(fields, TASK_TEXT_KEYS, undefined, MAX_TASK_LENGTH);
  if (task === undefined) {
    return undefined;
  }

  return {
    task,
    status: normalizeStatus(fields.status, fields.done === true || fields.completed === true),
  };
}

function normalizeTextPlan(raw: string): TodoPhase[] | undefined {
  const items = raw
    .split(/\r?\n/)
    .flatMap((line) => {
      const parsed = parseTaskLine(line);
      return parsed === undefined ? [] : [{ task: parsed.task, status: parsed.status ?? "pending" }];
    })
    .slice(0, MAX_ITEMS_PER_PHASE);

  return items.length === 0 ? undefined : [{ phase: DEFAULT_PHASE, items }];
}

function parseTaskLine(line: string): ParsedTaskLine | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const status = parseLineStatus(trimmed);
  const task = stripLineMarker(trimmed);
  const cleaned = cleanLabel(task, MAX_TASK_LENGTH);
  return cleaned.length === 0 ? undefined : { task: cleaned, ...(status === undefined ? {} : { status }) };
}

function parseLineStatus(line: string): TodoItemStatus | undefined {
  if (/^\[[xX]\]\s+/.test(line) || /^done\s*[:\-]\s*/i.test(line)) {
    return "done";
  }
  if (/^\[[!]\]\s+/.test(line) || /^blocked\s*[:\-]\s*/i.test(line)) {
    return "blocked";
  }
  if (/^\[[>]\]\s+/.test(line) || /^(current|active|in[-_ ]progress)\s*[:\-]\s*/i.test(line)) {
    return "in_progress";
  }
  return undefined;
}

function stripLineMarker(line: string): string {
  return line
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[[ xX!>]\]\s+/, "")
    .replace(/^(done|blocked|current|active|in[-_ ]progress)\s*[:\-]\s*/i, "");
}

/**
 * The renderer expects one active item. If the model gives none, promote the
 * first unblocked open task; if it gives many, keep the first and demote the
 * rest. Completed and blocked tasks are never promoted.
 */
function ensureSingleActive(phases: readonly TodoPhase[]): TodoPhase[] {
  let foundActive = false;
  let firstOpen: TaskLocation | undefined;

  const normalized = phases.map((phase, phaseIndex) => ({
    phase: phase.phase,
    items: phase.items.map((item, itemIndex) => {
      if (firstOpen === undefined && isOpen(item)) {
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

  return promoteTask(normalized, firstOpen);
}

function promoteTask(phases: readonly TodoPhase[], target: TaskLocation): TodoPhase[] {
  return phases.map((phase, phaseIndex) => ({
    phase: phase.phase,
    items: phase.items.map((item, itemIndex) => (
      phaseIndex === target.phaseIndex && itemIndex === target.itemIndex
        ? { ...item, status: "in_progress" as const }
        : item
    )),
  }));
}

function countTodoItems(phases: readonly TodoPhase[]): { readonly pending: number; readonly done: number; readonly total: number } {
  let pending = 0;
  let done = 0;
  let total = 0;

  for (const phase of phases) {
    for (const item of phase.items) {
      total += 1;
      if (item.status === "done") {
        done += 1;
      } else {
        pending += 1;
      }
    }
  }

  return { pending, done, total };
}

function findActiveTask(phases: readonly TodoPhase[]): string | undefined {
  for (const phase of phases) {
    for (const item of phase.items) {
      if (item.status === "in_progress") {
        return `${phase.phase}: ${item.task}`;
      }
    }
  }
  return undefined;
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

function isOpen(item: TodoItem): boolean {
  return item.status !== "done" && item.status !== "blocked";
}

function hasTaskArray(value: unknown): boolean {
  const fields = objectFields(value);
  return fields !== undefined && readTaskArray(fields) !== undefined;
}

function readTaskArray(fields: UnknownFields): readonly unknown[] | undefined {
  return Array.isArray(fields.items) ? fields.items : Array.isArray(fields.tasks) ? fields.tasks : undefined;
}

function readFirstString<const Keys extends readonly string[]>(
  fields: UnknownFields,
  keys: Keys,
  fallback: string | undefined,
  maxLength: number,
): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return cleanLabel(value, maxLength);
    }
  }
  return fallback === undefined ? undefined : cleanLabel(fallback, maxLength);
}

function cleanLabel(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function objectFields(value: unknown): UnknownFields | undefined {
  return typeof value === "object" && value !== null ? value as UnknownFields : undefined;
}
