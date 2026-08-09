export type ChangeSummary = {
  readonly kind: "created" | "updated" | "overwritten";
  readonly path: string;
  readonly diff: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly truncated: boolean;
};

type DiffSummary = Pick<ChangeSummary, "diff" | "addedLines" | "removedLines" | "truncated">;

const MAX_DIFF_LINES = 80;
/**
 * Creates a compact diff preview for tool output without shelling out to git.
 *
 * The summary is intentionally simple and fast: it compares lines by index,
 * counts visible additions/removals while building the preview, and stops once
 * the display budget is reached.
 */
export function createChangeSummary(path: string, before: string | undefined, after: string, kind: ChangeSummary["kind"]): ChangeSummary {
  return {
    kind,
    path,
    ...unifiedDiff(path, before ?? "", after, before === undefined),
  };
}

function unifiedDiff(path: string, before: string, after: string, isNewFile: boolean): DiffSummary {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const lines = [`--- ${isNewFile ? "/dev/null" : `a/${path}`}`, `+++ b/${path}`];
  const max = Math.max(beforeLines.length, afterLines.length);
  let emitted = 0;
  let addedLines = 0;
  let removedLines = 0;
  let truncated = false;

  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      continue;
    }
    if (emitted === 0) {
      lines.push("@@ changed-lines @@");
    }
    if (oldLine !== undefined) {
      lines.push(`-${oldLine}`);
      removedLines += 1;
      emitted += 1;
    }
    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
      addedLines += 1;
      emitted += 1;
    }
    if (emitted >= MAX_DIFF_LINES) {
      lines.push(`... diff truncated at ${MAX_DIFF_LINES} changed lines`);
      truncated = true;
      break;
    }
  }

  if (emitted === 0) {
    lines.push("@@ no textual changes @@");
  }
  return { diff: lines.join("\n"), addedLines, removedLines, truncated };
}

function splitLines(text: string): readonly string[] {
  if (text.length === 0) {
    return [];
  }
  return text.replace(/\n$/u, "").split("\n");
}
