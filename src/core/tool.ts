import type { Logger } from "./logger.js";
import type { WorkspacePathPolicy } from "./path-policy.js";

export type JsonSchema = Record<string, unknown>;

export type ToolContext = {
  readonly logger: Logger;
  readonly pathPolicy: WorkspacePathPolicy;
};

export interface Tool<I, O> {
  readonly name: string;
  readonly schema: JsonSchema;
  execute(input: I, context: ToolContext): Promise<O>;
}

export class ToolError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
