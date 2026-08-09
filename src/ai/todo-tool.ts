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

type TodoInput = {
  readonly phases: readonly TodoPhase[];
};

type TodoOutput = {
  readonly phases: readonly TodoPhase[];
  readonly current?: string;
  readonly pending: number;
  readonly done: number;
  readonly total: number;
};

const TODO_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["phases"],
  properties: {
    phases: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["phase", "items"],
        properties: {
          phase: { type: "string", minLength: 1, maxLength: 60 },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["task", "status"],
              properties: {
                task: { type: "string", minLength: 1, maxLength: 120 },
                status: { enum: ["pending", "in_progress", "done", "blocked"] },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** Creates a session-local todo tool so the TUI can show current and pending work. */
export function createTodoTool(): AiSdkTool {
  let latest: TodoOutput = { phases: [], pending: 0, done: 0, total: 0 };

  return tool({
    title: "Show todo plan",
    description: "Show the user a live todo list with current in-progress work, pending tasks, blocked tasks, and completed tasks. Call before non-trivial work and after each task state change.",
    inputSchema: jsonSchema(TODO_INPUT_SCHEMA as never),
    strict: true,
    execute: async (input: TodoInput): Promise<TodoOutput> => {
      latest = summarizeTodos(input.phases);
      return latest;
    },
  });
}

function summarizeTodos(phases: readonly TodoPhase[]): TodoOutput {
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
  };
}
