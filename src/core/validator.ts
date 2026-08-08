import { Ajv, type ValidateFunction } from "ajv";
import type { JsonSchema } from "./tool.js";
import { ToolError } from "./tool.js";

/** Compiles tool schemas once, then reuses validators on every call. */
export class SchemaValidator {
  private readonly ajv = new Ajv({ allErrors: true, strict: true });
  private readonly validators = new Map<string, ValidateFunction>();

  public validate(toolName: string, schema: JsonSchema, input: unknown): void {
    const validator = this.validators.get(toolName) ?? this.ajv.compile(schema);
    if (!this.validators.has(toolName)) {
      this.validators.set(toolName, validator);
    }

    if (validator(input)) {
      return;
    }

    throw new ToolError("Tool input failed schema validation", "SCHEMA_INVALID", {
      toolName,
      errors: validator.errors ?? [],
    });
  }
}
