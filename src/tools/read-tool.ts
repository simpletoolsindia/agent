import type { Dirent, Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { sha256, shortHash } from "../core/hash.js";
import { LineIndex } from "../core/line-index.js";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";


const DEFAULT_FILE_LINE_LIMIT = 120;
const DIRECTORY_ENTRY_LIMIT = 200;
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
  readonly nextStartLine?: number;
};

/** Workspace reader. It is the only tool that returns hashes for later edits. */
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
    const meta = await this.statPath(absPath, input.path);

    if (meta.isDirectory()) {
      return this.readDirectory(input.path, absPath, context);
    }

    return this.readFile(input, absPath, context);
  }

  private async readDirectory(inputPath: string, absPath: string, context: ToolContext): Promise<ReadOutput> {
    const dirents = await readdir(absPath, { withFileTypes: true });
    const visible = dirents.slice(0, DIRECTORY_ENTRY_LIMIT);
    const entries = await Promise.all(visible.map(async (entry) => this.toDirectoryEntry(entry, inputPath, absPath)));

    context.logger.info("directory.read", { path: inputPath, returned: entries.length, total: dirents.length });
    return { path: inputPath, kind: "directory", entries, truncated: dirents.length > entries.length };
  }

  private async toDirectoryEntry(entry: Dirent, inputPath: string, absPath: string): Promise<NonNullable<ReadOutput["entries"]>[number]> {
    const childInputPath = joinInputPath(inputPath, entry.name);
    const childPath = join(absPath, entry.name);
    const childStat = await this.statPath(childPath, childInputPath);
    return {
      name: entry.name,
      kind: entry.isDirectory() ? "directory" as const : "file" as const,
      size: childStat.size,
    };
  }

  private async readFile(input: ReadInput, absPath: string, context: ToolContext): Promise<ReadOutput> {
    const content = await readFile(absPath, "utf8");
    const index = new LineIndex(content);
    const fileHash = sha256(content);
    const lineCount = index.lineCount();
    const startLine = input.startLine ?? 1;
    const limitLines = input.limitLines ?? DEFAULT_FILE_LINE_LIMIT;

    if (lineCount > 0 && startLine > lineCount) {
      throw new ToolError("Read startLine is beyond the end of the file", "READ_RANGE_INVALID", {
        path: input.path,
        startLine,
        lineCount,
      });
    }

    const endLine = lineCount === 0 ? 1 : Math.min(lineCount, startLine + limitLines - 1);
    const range = lineCount === 0
      ? { text: "", hash: sha256(""), startLine: 1, endLine: 1 }
      : index.range(startLine, endLine);
    const truncated = lineCount > 0 && endLine < lineCount;

    context.logger.info("file.read", {
      name: basename(absPath),
      lineCount,
      returnedLines: lineCount === 0 ? 0 : endLine - startLine + 1,
      truncated,
    });

    return {
      path: input.path,
      kind: "file",
      fileHash,
      displayHash: shortHash(fileHash),
      rangeHash: range.hash,
      startLine,
      endLine,
      lineCount,
      content: range.text,
      truncated,
      ...(truncated ? { nextStartLine: endLine + 1 } : {}),
    };
  }

  private async statPath(absPath: string, inputPath: string): Promise<Stats> {
    try {
      return await stat(absPath);
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) {
        throw new ToolError("Path does not exist; search or list the parent directory before reading", "PATH_NOT_FOUND", {
          path: inputPath,
        });
      }

      throw error;
    }
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function joinInputPath(parent: string, child: string): string {
  return parent === "." || parent === "" ? child : `${parent.replace(/\/$/u, "")}/${child}`;
}
