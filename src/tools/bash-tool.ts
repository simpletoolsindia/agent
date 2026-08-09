import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { execa } from "execa";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export type BashInput = {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

export type BashOutput = {
  readonly command: string;
  readonly cwd: string;
  readonly statusLine: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly truncated: boolean;
};

export class BashTool implements Tool<BashInput, BashOutput> {
  public readonly name = "bash";
  public readonly schema = {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: { type: "string", minLength: 1 },
      cwd: { type: "string", minLength: 1 },
      timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
      maxOutputBytes: { type: "integer", minimum: 1024, maximum: MAX_OUTPUT_BYTES },
    },
  };

  public async execute(input: BashInput, context: ToolContext): Promise<BashOutput> {
    const cwdInput = input.cwd ?? ".";
    const cwd = context.pathPolicy.resolveInside(cwdInput);
    await this.assertDirectory(cwd, cwdInput);

    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const shell = shellCommand(input.command);
    const result = await execa(shell.file, shell.args, {
      cwd,
      reject: false,
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: Math.min(MAX_OUTPUT_BYTES * 2, Math.max(maxOutputBytes * 2, DEFAULT_MAX_OUTPUT_BYTES)),
    });

    if (result.timedOut) {
      throw new ToolError("Command timed out", "BASH_TIMEOUT", {
        command: input.command,
        cwd: cwdInput,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    }

    if (result.failed && result.exitCode === undefined) {
      throw new ToolError("Command could not be started; verify the executable name or use an absolute path", "BASH_SPAWN_FAILED", {
        command: input.command,
        cwd: cwdInput,
        stderr: result.stderr,
      });
    }

    const stdout = truncateUtf8(result.stdout, maxOutputBytes);
    const stderr = truncateUtf8(result.stderr, maxOutputBytes);
    const exitCode = result.exitCode ?? 0;
    const truncated = stdout.truncated || stderr.truncated;

    context.logger.info("process.run", {
      command: input.command,
      exitCode,
      stdoutBytes: stdout.originalBytes,
      stderrBytes: stderr.originalBytes,
      truncated,
    });

    return {
      command: input.command,
      cwd: cwdInput,
      statusLine: `running: ${input.command}`,
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutBytes: stdout.originalBytes,
      stderrBytes: stderr.originalBytes,
      truncated,
    };
  }

  private async assertDirectory(absPath: string, inputPath: string): Promise<void> {
    const meta = await this.statPath(absPath, inputPath);
    if (!meta.isDirectory()) {
      throw new ToolError("Working directory is not a directory", "BASH_CWD_NOT_DIRECTORY", { cwd: inputPath });
    }
  }

  private async statPath(absPath: string, inputPath: string): Promise<Stats> {
    try {
      return await stat(absPath);
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) {
        throw new ToolError("Working directory does not exist", "BASH_CWD_NOT_FOUND", { cwd: inputPath });
      }

      throw error;
    }
  }
}

function shellCommand(command: string): { readonly file: string; readonly args: readonly string[] } {
  if (process.platform === "win32") {
    return { file: "cmd.exe", args: ["/d", "/s", "/c", command] };
  }

  return { file: "/bin/bash", args: ["-c", command] };
}

function truncateUtf8(text: string, maxBytes: number): { readonly text: string; readonly originalBytes: number; readonly truncated: boolean } {
  const originalBytes = Buffer.byteLength(text, "utf8");
  if (originalBytes <= maxBytes) {
    return { text, originalBytes, truncated: false };
  }

  const marker = `\n...[truncated ${originalBytes - maxBytes} bytes]`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  const keptBytes = Math.max(0, maxBytes - markerBytes);
  return {
    text: `${Buffer.from(text, "utf8").subarray(0, keptBytes).toString("utf8")}${marker}`,
    originalBytes,
    truncated: true,
  };
}

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
