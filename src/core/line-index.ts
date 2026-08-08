import { sha256 } from "./hash.js";

export type LineRange = {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly hash: string;
};

/** Maintains 1-indexed line addressing while preserving exact line bytes. */
export class LineIndex {
  private readonly lines: string[];

  public constructor(private readonly content: string) {
    this.lines = content.split(/(?<=\n)/u);
  }

  public lineCount(): number {
    return this.lines.length === 1 && this.lines[0] === "" ? 0 : this.lines.length;
  }

  public range(startLine: number, endLine: number): LineRange {
    const count = this.lineCount();
    if (startLine < 1 || endLine < startLine || endLine > count) {
      throw new Error(`Invalid line range ${startLine}-${endLine}; file has ${count} lines`);
    }

    const text = this.lines.slice(startLine - 1, endLine).join("");
    return { startLine, endLine, text, hash: sha256(text) };
  }

  public replace(startLine: number, endLine: number, replacement: string): string {
    const count = this.lineCount();
    if (startLine < 1 || endLine < startLine || endLine > count) {
      throw new Error(`Invalid line range ${startLine}-${endLine}; file has ${count} lines`);
    }

    const nextLines = [
      ...this.lines.slice(0, startLine - 1),
      replacement,
      ...this.lines.slice(endLine),
    ];

    return nextLines.join("");
  }
}
