import type { DurabilityMode } from "../core/file-store.js";
import { NodeFileStore } from "../core/file-store.js";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";
import { LineIndex } from "../core/line-index.js";
import { shortHash } from "../core/hash.js";
import { createChangeSummary, type ChangeSummary } from "./change-summary.js";
import { validateLspAvailability, type LspValidation } from "./lsp-validator.js";

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
  readonly change: ChangeSummary;
  readonly lspValidation: LspValidation;
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

    const index = new LineIndex(current.content);
    const sorted = [...input.operations].sort((left, right) => right.startLine - left.startLine);
    this.assertNoOverlap(sorted);
    this.assertValidRanges(sorted, index.lineCount(), input.path);
    this.assertExpectedHashes(sorted, index, input.path);

    const next = applyReplacements(current.content, sorted);
    const durability = input.durability ?? "safe";
    const written = await this.files.writeTextAtomic(absPath, next, durability);
    context.logger.info("file.update", { path: input.path, applied: input.operations.length, durability });

    return {
      path: input.path,
      fileHash: written.hash,
      displayHash: shortHash(written.hash),
      applied: input.operations.length,
      change: createChangeSummary(input.path, current.content, next, "updated"),
      lspValidation: await validateLspAvailability(input.path),
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

  private assertValidRanges(operations: readonly ReplaceOperation[], lineCount: number, path: string): void {
    for (const operation of operations) {
      if (operation.startLine < 1 || operation.endLine < operation.startLine || operation.endLine > lineCount) {
        throw new ToolError("Update range is outside the current file", "UPDATE_RANGE_INVALID", {
          path,
          startLine: operation.startLine,
          endLine: operation.endLine,
          lineCount,
        });
      }
    }
  }

  private assertExpectedHashes(operations: readonly ReplaceOperation[], index: LineIndex, path: string): void {
    for (const operation of operations) {
      const existing = index.range(operation.startLine, operation.endLine);
      if (existing.hash !== operation.expectedHash) {
        throw new ToolError("Range hash mismatch; refusing unsafe edit", "UPDATE_RANGE_CHANGED", {
          path,
          startLine: operation.startLine,
          endLine: operation.endLine,
          expected: shortHash(operation.expectedHash),
          actual: shortHash(existing.hash),
        });
      }
    }
  }
}

function applyReplacements(content: string, operations: readonly ReplaceOperation[]): string {
  const lines = content.split(/(?<=\n)/u);
  const chunks: string[] = [];
  let cursor = lines.length;

  for (const operation of operations) {
    chunks.push(lines.slice(operation.endLine, cursor).join(""));
    chunks.push(operation.content);
    cursor = operation.startLine - 1;
  }

  chunks.push(lines.slice(0, cursor).join(""));
  return chunks.reverse().join("");
}
