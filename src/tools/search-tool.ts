import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";

const require = createRequire(import.meta.url);
const { rgPath } = require("@vscode/ripgrep") as { rgPath: string };

const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_STDERR_BYTES = 64 * 1024;

export type SearchInput = {
  readonly query: string;
  readonly path?: string;
  readonly maxMatches?: number;
  readonly literal?: boolean;
  readonly caseSensitive?: boolean;
  readonly glob?: string;
};

export type SearchOutput = {
  readonly matches: Array<{ readonly path: string; readonly line: number; readonly text: string }>;
  readonly truncated: boolean;
};

/** Ripgrep-backed search. The tool streams JSON events and stops as soon as enough matches are collected. */
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
      literal: { type: "boolean" },
      caseSensitive: { type: "boolean" },
      glob: { type: "string", minLength: 1 },
    },
  };

  public async execute(input: SearchInput, context: ToolContext): Promise<SearchOutput> {
    const maxMatches = input.maxMatches ?? DEFAULT_MAX_MATCHES;
    const root = context.pathPolicy.resolveInside(input.path ?? ".");
    const args = ripgrepArgs(input, root);
    const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const closePromise = waitForClose(child);
    const stderrChunks: string[] = [];
    let stderrBytes = 0;
    let stoppedAfterLimit = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, DEFAULT_TIMEOUT_MS);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderrBytes >= MAX_STDERR_BYTES) {
        return;
      }

      stderrBytes += Buffer.byteLength(chunk, "utf8");
      stderrChunks.push(chunk);
    });

    const matches: SearchOutput["matches"] = [];

    try {
      if (child.stdout === null) {
        throw new ToolError("Ripgrep stdout was not available", "SEARCH_FAILED", { query: input.query });
      }

      child.stdout.setEncoding("utf8");
      // --json keeps parsing deterministic and avoids token-heavy context lines.
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        if (line.length === 0) {
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

        if (matches.length >= maxMatches) {
          stoppedAfterLimit = true;
          lines.close();
          child.kill("SIGTERM");
          break;
        }
      }

      const close = await closePromise;
      clearTimeout(timeout);

      if (timedOut) {
        throw new ToolError("Ripgrep search timed out", "SEARCH_TIMEOUT", { query: input.query, path: input.path ?? "." });
      }

      if (!stoppedAfterLimit && close.exitCode !== 0 && close.exitCode !== 1) {
        throw new ToolError("Ripgrep search failed", "SEARCH_FAILED", {
          exitCode: close.exitCode,
          signal: close.signal,
          stderr: stderrChunks.join("").trim(),
        });
      }

      context.logger.info("search.complete", { query: input.query, matches: matches.length, truncated: stoppedAfterLimit });
      return { matches, truncated: stoppedAfterLimit };
    } finally {
      clearTimeout(timeout);
    }
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

function ripgrepArgs(input: SearchInput, root: string): string[] {
  const args = ["--json", "--line-number", "--color", "never"];
  if (input.literal === true) {
    args.push("--fixed-strings");
  }
  if (input.caseSensitive === false) {
    args.push("--ignore-case");
  }
  if (input.glob !== undefined) {
    args.push("--glob", input.glob);
  }
  args.push(input.query, root);
  return args;
}

function waitForClose(child: ReturnType<typeof spawn>): Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>();
  child.once("error", reject);
  child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  return promise;
}
