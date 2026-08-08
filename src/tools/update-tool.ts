import type { DurabilityMode } from "../core/file-store.js";
import { NodeFileStore } from "../core/file-store.js";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";
import { LineIndex } from "../core/line-index.js";
import { shortHash } from "../core/hash.js";

export type ReplaceOperation = {
  readonly kind: "replace";
  readonly startLine: number;
  readonly endLine: number;
  readonly expectedHash: string;
  readonly content: string;
};

export type UpdateInput = {
  readonly path: string;
  readonly fileHash: string;
  readonly operations: readonly ReplaceOperation[];
  readonly durability?: DurabilityMode;
};

export type UpdateOutput = {
  readonly path: string;
  readonly fileHash: string;
  readonly displayHash: string;
  readonly applied: number;
};

export class UpdateTool implements Tool<UpdateInput, UpdateOutput> {
  public readonly name = "update";
  public readonly schema = {
    type: "object",
    additionalProperties: false,
    required: ["path", "fileHash", "operations"],
    properties: {
      path: { type: "string", minLength: 1 },
      fileHash: { type: "string", minLength: 64, maxLength: 64 },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "startLine", "endLine", "expectedHash", "content"],
          properties: {
            kind: { const: "replace" },
            startLine: { type: "integer", minimum: 1 },
            endLine: { type: "integer", minimum: 1 },
            expectedHash: { type: "string", minLength: 64, maxLength: 64 },
            content: { type: "string" },
          },
        },
      },
      durability: { enum: ["safe", "fast"] },
    },
  };

  private readonly files = new NodeFileStore();

  public async execute(input: UpdateInput, context: ToolContext): Promise<UpdateOutput> {
    const absPath = context.pathPolicy.resolveInside(input.path);
    const current = await this.files.readText(absPath);

    if (current.hash !== input.fileHash) {
      throw new ToolError("File changed since read; re-read before updating", "UPDATE_STALE_FILE", {
        path: input.path,
        expected: shortHash(input.fileHash),
        actual: shortHash(current.hash),
      });
    }

    const sorted = [...input.operations].sort((left, right) => right.startLine - left.startLine);
    this.assertNoOverlap(sorted);

    let next = current.content;
    for (const operation of sorted) {
      const index = new LineIndex(next);
      const existing = index.range(operation.startLine, operation.endLine);
      if (existing.hash !== operation.expectedHash) {
        throw new ToolError("Range hash mismatch; refusing unsafe edit", "UPDATE_RANGE_CHANGED", {
          path: input.path,
          startLine: operation.startLine,
          endLine: operation.endLine,
          expected: shortHash(operation.expectedHash),
          actual: shortHash(existing.hash),
        });
      }
      next = index.replace(operation.startLine, operation.endLine, operation.content);
    }

    const durability = input.durability ?? "safe";
    const written = await this.files.writeTextAtomic(absPath, next, durability);
    context.logger.info("file.update", { path: input.path, applied: input.operations.length, durability });

    return {
      path: input.path,
      fileHash: written.hash,
      displayHash: shortHash(written.hash),
      applied: input.operations.length,
    };
  }

  private assertNoOverlap(operations: readonly ReplaceOperation[]): void {
    for (let index = 1; index < operations.length; index += 1) {
      const previous = operations[index - 1];
      const current = operations[index];
      if (current.endLine >= previous.startLine) {
        throw new ToolError("Overlapping update operations are not allowed", "UPDATE_OVERLAP", {
          first: `${previous.startLine}-${previous.endLine}`,
          second: `${current.startLine}-${current.endLine}`,
        });
      }
    }
  }
}
