import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { execa } from "execa";
import type { Tool, ToolContext } from "../core/tool.js";
import { ToolError } from "../core/tool.js";

export type BashInput = {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
};

export type BashOutput = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class BashTool implements Tool<BashInput, BashOutput> {
  public readonly name = "bash";
  public readonly schema = {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: { type: "string", minLength: 1 },
      args: { type: "array", items: { type: "string" }, maxItems: 100 },
      cwd: { type: "string", minLength: 1 },
      timeoutMs: { type: "integer", minimum: 1, maximum: 120000 },
    },
  };

  public async execute(input: BashInput, context: ToolContext): Promise<BashOutput> {
    const cwdInput = input.cwd ?? ".";
    const cwd = context.pathPolicy.resolveInside(cwdInput);
    await this.assertDirectory(cwd, cwdInput);

    const result = await execa(input.command, [...(input.args ?? [])], {
      cwd,
      reject: false,
      timeout: input.timeoutMs ?? 10000,
      maxBuffer: 1024 * 1024,
    });

    if (result.failed && result.exitCode === undefined) {
      throw new ToolError("Command could not be started; verify the executable name or use an absolute path", "BASH_SPAWN_FAILED", {
        command: input.command,
        cwd: cwdInput,
        stderr: result.stderr,
      });
    }

    const exitCode = result.exitCode ?? 0;
    context.logger.info("process.run", { command: input.command, exitCode });
    return { exitCode, stdout: result.stdout, stderr: result.stderr };
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

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
