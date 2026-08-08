import { execa } from "execa";
import type { Tool, ToolContext } from "../core/tool.js";

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
    const cwd = input.cwd === undefined ? undefined : context.pathPolicy.resolveInside(input.cwd);
    const result = await execa(input.command, [...(input.args ?? [])], {
      cwd,
      reject: false,
      timeout: input.timeoutMs ?? 10000,
      maxBuffer: 1024 * 1024,
    });

    const exitCode = result.exitCode ?? 0;
    context.logger.info("process.run", { command: input.command, exitCode });
    return { exitCode, stdout: result.stdout, stderr: result.stderr };
  }
}
