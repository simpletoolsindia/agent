import { z, type ZodTypeAny } from "zod";
import type { JsonSchema } from "./tool.js";
import { ToolError } from "./tool.js";

/** Compiles tool schemas once with Zod, then reuses validators for every LLM tool-call JSON payload. */
export class SchemaValidator {
  private readonly validators = new Map<string, ZodTypeAny>();

  public validate(toolName: string, schema: JsonSchema, input: unknown): void {
    const validator = this.validators.get(toolName) ?? compileJsonSchema(schema);
    if (!this.validators.has(toolName)) {
      this.validators.set(toolName, validator);
    }

    const result = validator.safeParse(input);
    if (result.success) {
      return;
    }

    throw new ToolError("Tool input failed schema validation", "SCHEMA_INVALID", {
      toolName,
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
}

function compileJsonSchema(schema: JsonSchema): ZodTypeAny {
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((value): value is string | number | boolean => ["string", "number", "boolean"].includes(typeof value));
    return values.length === 0 ? z.never() : z.custom((value) => values.includes(value as never), `Expected one of: ${values.join(", ")}`);
  }

  if ("const" in schema) {
    const value = schema.const;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return z.literal(value);
    }
    return z.never();
  }

  switch (schema.type) {
    case "object": {
      const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
      const properties = typeof schema.properties === "object" && schema.properties !== null ? schema.properties as Record<string, JsonSchema> : {};
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, value] of Object.entries(properties)) {
        const child = compileJsonSchema(value);
        shape[key] = required.has(key) ? child : child.optional();
      }
      const objectSchema = z.object(shape);
      return schema.additionalProperties === false ? objectSchema.strict() : objectSchema.passthrough();
    }
    case "array": {
      const itemSchema = typeof schema.items === "object" && schema.items !== null ? compileJsonSchema(schema.items as JsonSchema) : z.unknown();
      let arraySchema = z.array(itemSchema);
      if (typeof schema.minItems === "number") {
        arraySchema = arraySchema.min(schema.minItems);
      }
      if (typeof schema.maxItems === "number") {
        arraySchema = arraySchema.max(schema.maxItems);
      }
      return arraySchema;
    }
    case "string": {
      let stringSchema = z.string();
      if (typeof schema.minLength === "number") {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (typeof schema.maxLength === "number") {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      return stringSchema;
    }
    case "integer": {
      let numberSchema = z.number().int();
      if (typeof schema.minimum === "number") {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === "number") {
        numberSchema = numberSchema.max(schema.maximum);
      }
      return numberSchema;
    }
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default:
      return z.unknown();
  }
}
