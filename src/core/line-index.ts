import { sha256 } from "./hash.js";

export type LineRange = {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly hash: string;
};

export type LineReplacement = {
  readonly startLine: number;
  readonly endLine: number;
  readonly content: string;
};

/**
 * Maintains 1-indexed line addressing while preserving the original newline
 * bytes. Read/update both use this class, so a range hash always describes the
 * exact text that update will later verify.
 */
export class LineIndex {
  private readonly lines: string[];
  private readonly count: number;

  public constructor(content: string) {
    this.lines = content.split(/(?<=\n)/u);
    this.count = this.lines.length === 1 && this.lines[0] === "" ? 0 : this.lines.length;
  }

  public lineCount(): number {
    return this.count;
  }

  public range(startLine: number, endLine: number): LineRange {
    this.assertValidRange(startLine, endLine);
    const text = this.rangeText(startLine, endLine);
    return { startLine, endLine, text, hash: sha256(text) };
  }

  public replace(startLine: number, endLine: number, replacement: string): string {
    return this.replaceMany([{ startLine, endLine, content: replacement }]);
  }

  /**
   * Applies ranges sorted from bottom to top. That lets callers replace many
   * spans without recalculating offsets after each edit and avoids a second
   * regex split in the update tool.
   */
  public replaceMany(replacements: readonly LineReplacement[]): string {
    const chunks: string[] = [];
    let cursor = this.lines.length;

    for (const replacement of replacements) {
      this.assertValidRange(replacement.startLine, replacement.endLine);
      chunks.push(this.joinLines(replacement.endLine, cursor));
      chunks.push(replacement.content);
      cursor = replacement.startLine - 1;
    }

    chunks.push(this.joinLines(0, cursor));
    return chunks.reverse().join("");
  }

  private assertValidRange(startLine: number, endLine: number): void {
    if (startLine < 1 || endLine < startLine || endLine > this.count) {
      throw new Error(`Invalid line range ${startLine}-${endLine}; file has ${this.count} lines`);
    }
  }

  private rangeText(startLine: number, endLine: number): string {
    return this.joinLines(startLine - 1, endLine);
  }

  private joinLines(start: number, end: number): string {
    let text = "";
    for (let index = start; index < end; index += 1) {
      text += this.lines[index] ?? "";
    }
    return text;
  }
}
