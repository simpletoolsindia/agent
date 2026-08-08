import type { Tool, ToolContext } from "./tool.js";
import { ToolError } from "./tool.js";
import { SchemaValidator } from "./validator.js";

export type ToolResult<O> = {
  readonly ok: true;
  readonly output: O;
  readonly elapsedMs: number;
} | {
  readonly ok: false;
  readonly error: string;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly elapsedMs: number;
};

/** Central dispatch point. It keeps validation, logging, and timing consistent. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown, unknown>>();
  private readonly validator = new SchemaValidator();

  public register<I, O>(tool: Tool<I, O>): void {
    this.tools.set(tool.name, tool as Tool<unknown, unknown>);
  }

  public async run<O>(name: string, input: unknown, context: ToolContext): Promise<ToolResult<O>> {
    const started = performance.now();
    const tool = this.tools.get(name);

    if (tool === undefined) {
      return {
        ok: false,
        error: `Unknown tool: ${name}`,
        code: "TOOL_NOT_FOUND",
        elapsedMs: performance.now() - started,
      };
    }

    const logger = context.logger.child(name);
    logger.info("tool.start", { inputKeys: Object.keys(input as Record<string, unknown>) });

    try {
      this.validator.validate(name, tool.schema, input);
      const output = await tool.execute(input, { ...context, logger });
      const elapsedMs = performance.now() - started;
      logger.info("tool.finish", { elapsedMs });
      return { ok: true, output: output as O, elapsedMs };
    } catch (error) {
      const elapsedMs = performance.now() - started;
      const normalized = error instanceof ToolError
        ? { message: error.message, code: error.code, details: error.details }
        : { message: error instanceof Error ? error.message : String(error), code: "TOOL_FAILED" };

      logger.error("tool.fail", { elapsedMs, code: normalized.code, error: normalized.message });
      return {
        ok: false,
        error: normalized.message,
        code: normalized.code,
        details: normalized.details,
        elapsedMs,
      };
    }
  }
}
