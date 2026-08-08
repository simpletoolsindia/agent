import type { Tool } from "../core/tool.js";
import { BashTool } from "./bash-tool.js";
import { ReadTool } from "./read-tool.js";
import { SearchTool } from "./search-tool.js";
import { UpdateTool } from "./update-tool.js";
import { WriteTool } from "./write-tool.js";

export type ToolSafety = "read-only" | "write" | "execute";

export type HarnessToolMetadata = {
  readonly title: string;
  readonly description: string;
  readonly safety: ToolSafety;
};

export type HarnessToolDefinition = {
  readonly tool: Tool<unknown, unknown>;
  readonly metadata: HarnessToolMetadata;
};

/** Single source for the five exposed tools and their model-facing descriptions. */
export function createToolCatalog(): HarnessToolDefinition[] {
  return [
    {
      tool: new ReadTool() as Tool<unknown, unknown>,
      metadata: {
        title: "Read file or directory",
        description: "Read a workspace file slice or list a workspace directory. Returns file hashes and range hashes for safe updates.",
        safety: "read-only",
      },
    },
    {
      tool: new SearchTool() as Tool<unknown, unknown>,
      metadata: {
        title: "Search files",
        description: "Search workspace files with ripgrep. Use this before reading when locating code or text.",
        safety: "read-only",
      },
    },
    {
      tool: new WriteTool() as Tool<unknown, unknown>,
      metadata: {
        title: "Write file",
        description: "Create or overwrite a workspace text file atomically. Use overwrite=true only when replacing an existing file intentionally.",
        safety: "write",
      },
    },
    {
      tool: new UpdateTool() as Tool<unknown, unknown>,
      metadata: {
        title: "Update file",
        description: "Apply hash-guarded line replacements. You must read the target range first and pass the fresh fileHash and rangeHash.",
        safety: "write",
      },
    },
    {
      tool: new BashTool() as Tool<unknown, unknown>,
      metadata: {
        title: "Run command",
        description: "Run one non-interactive command with explicit argv in the workspace. Prefer this for verification commands.",
        safety: "execute",
      },
    },
  ];
}
