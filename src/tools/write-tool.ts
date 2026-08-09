import type { DurabilityMode } from "../core/file-store.js";
import { NodeFileStore } from "../core/file-store.js";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";
import { shortHash } from "../core/hash.js";
import { createChangeSummary, type ChangeSummary } from "./change-summary.js";
import { validateLspAvailability, type LspValidation } from "./lsp-validator.js";

export type WriteInput = {
  readonly path: string;
  readonly content: string;
  readonly overwrite?: boolean;
  readonly durability?: DurabilityMode;
};

export type WriteOutput = {
  readonly path: string;
  readonly fileHash: string;
  readonly displayHash: string;
  readonly bytes: number;
  readonly change: ChangeSummary;
  readonly lspValidation: LspValidation;
};

export class WriteTool implements Tool<WriteInput, WriteOutput> {
  public readonly name = "write";
  public readonly schema = {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: { type: "string", minLength: 1 },
      content: { type: "string" },
      overwrite: { type: "boolean" },
      durability: { enum: ["safe", "fast"] },
    },
  };

  private readonly files = new NodeFileStore();

  public async execute(input: WriteInput, context: ToolContext): Promise<WriteOutput> {
    const absPath = context.pathPolicy.resolveInside(input.path);
    const exists = await this.files.exists(absPath);

    if (exists && input.overwrite !== true) {
      throw new ToolError("Refusing to overwrite existing file without overwrite=true", "WRITE_EXISTS", { path: input.path });
    }

    const previous = exists ? (await this.files.readText(absPath)).content : undefined;
    const durability = input.durability ?? "safe";
    const written = await this.files.writeTextAtomic(absPath, input.content, durability);
    context.logger.info("file.write", { path: input.path, bytes: Buffer.byteLength(input.content, "utf8"), durability });

    return {
      path: input.path,
      fileHash: written.hash,
      displayHash: shortHash(written.hash),
      bytes: Buffer.byteLength(input.content, "utf8"),
      change: createChangeSummary(input.path, previous, input.content, exists ? "overwritten" : "created"),
      lspValidation: await validateLspAvailability(input.path),
    };
  }
}
