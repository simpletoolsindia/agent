import { createRequire } from "node:module";
import { execa } from "execa";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";

const require = createRequire(import.meta.url);
const { rgPath } = require("@vscode/ripgrep") as { rgPath: string };

export type SearchInput = {
  readonly query: string;
  readonly path?: string;
  readonly maxMatches?: number;
};

export type SearchOutput = {
  readonly matches: Array<{ readonly path: string; readonly line: number; readonly text: string }>;
  readonly truncated: boolean;
};

export class SearchTool implements Tool<SearchInput, SearchOutput> {
  public readonly name = "search";
  public readonly schema = {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1 },
      path: { type: "string", minLength: 1 },
      maxMatches: { type: "integer", minimum: 1, maximum: 1000 },
    },
  };

  public async execute(input: SearchInput, context: ToolContext): Promise<SearchOutput> {
    const maxMatches = input.maxMatches ?? 100;
    const root = context.pathPolicy.resolveInside(input.path ?? ".");
    const result = await execa(rgPath, ["--json", "--line-number", input.query, root], {
      reject: false,
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new ToolError("Ripgrep search failed", "SEARCH_FAILED", {
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
    }

    const matches: SearchOutput["matches"] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.length === 0 || matches.length >= maxMatches) {
        continue;
      }

      const event = this.parseRipgrepEvent(line);
      if (event.type !== "match" || event.data?.path?.text === undefined || event.data.line_number === undefined) {
        continue;
      }

      matches.push({
        path: context.pathPolicy.relativeToRoot(event.data.path.text),
        line: event.data.line_number,
        text: event.data.lines?.text?.trimEnd() ?? "",
      });
    }

    context.logger.info("search.complete", { query: input.query, matches: matches.length });
    return { matches, truncated: matches.length >= maxMatches };
  }

  private parseRipgrepEvent(line: string): { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } } {
    try {
      return JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
    } catch (error) {
      throw new ToolError("Ripgrep returned invalid JSON", "SEARCH_PARSE_FAILED", {
        line,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
