import { readdir, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { Tool, ToolContext } from "../core/tool.js";
import { LineIndex } from "../core/line-index.js";
import { sha256, shortHash } from "../core/hash.js";

export type ReadInput = {
  readonly path: string;
  readonly startLine?: number;
  readonly limitLines?: number;
};

export type ReadOutput = {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly fileHash?: string;
  readonly displayHash?: string;
  readonly rangeHash?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly lineCount?: number;
  readonly content?: string;
  readonly entries?: Array<{ readonly name: string; readonly kind: "file" | "directory"; readonly size: number }>;
  readonly truncated: boolean;
};

export class ReadTool implements Tool<ReadInput, ReadOutput> {
  public readonly name = "read";
  public readonly schema = {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", minLength: 1 },
      startLine: { type: "integer", minimum: 1 },
      limitLines: { type: "integer", minimum: 1, maximum: 2000 },
    },
  };

  public async execute(input: ReadInput, context: ToolContext): Promise<ReadOutput> {
    const absPath = context.pathPolicy.resolveInside(input.path);
    const meta = await stat(absPath);

    if (meta.isDirectory()) {
      const dirents = await readdir(absPath, { withFileTypes: true });
      const visible = dirents.slice(0, 200);
      const entries = await Promise.all(visible.map(async (entry) => {
        const childPath = context.pathPolicy.resolveInside(`${input.path}/${entry.name}`);
        const childStat = await stat(childPath);
        return {
          name: entry.name,
          kind: entry.isDirectory() ? "directory" as const : "file" as const,
          size: childStat.size,
        };
      }));

      context.logger.info("directory.read", { path: input.path, returned: entries.length, total: dirents.length });
      return { path: input.path, kind: "directory", entries, truncated: dirents.length > entries.length };
    }

    const content = await readFile(absPath, "utf8");
    const index = new LineIndex(content);
    const fileHash = sha256(content);
    const startLine = input.startLine ?? 1;
    const limitLines = input.limitLines ?? 120;
    const endLine = Math.min(index.lineCount(), startLine + limitLines - 1);
    const range = index.lineCount() === 0
      ? { text: "", hash: sha256(""), startLine: 1, endLine: 1 }
      : index.range(startLine, endLine);

    context.logger.info("file.read", {
      name: basename(absPath),
      lineCount: index.lineCount(),
      returnedLines: endLine >= startLine ? endLine - startLine + 1 : 0,
    });

    return {
      path: input.path,
      kind: "file",
      fileHash,
      displayHash: shortHash(fileHash),
      rangeHash: range.hash,
      startLine,
      endLine,
      lineCount: index.lineCount(),
      content: range.text,
      truncated: endLine < index.lineCount(),
    };
  }
}
