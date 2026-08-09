export type ChangeSummary = {
  readonly kind: "created" | "updated" | "overwritten";
  readonly path: string;
  readonly diff: string;
};

const MAX_DIFF_LINES = 80;

/** Creates a compact unified diff preview for tool output without requiring git. */
export function createChangeSummary(path: string, before: string | undefined, after: string, kind: ChangeSummary["kind"]): ChangeSummary {
  return {
    kind,
    path,
    diff: unifiedDiff(path, before ?? "", after, before === undefined),
  };
}

function unifiedDiff(path: string, before: string, after: string, isNewFile: boolean): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const lines = [`--- ${isNewFile ? "/dev/null" : `a/${path}`}`, `+++ b/${path}`];
  const max = Math.max(beforeLines.length, afterLines.length);
  let emitted = 0;

  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      continue;
    }
    if (emitted === 0) {
      lines.push(`@@ changed-lines @@`);
    }
    if (oldLine !== undefined) {
      lines.push(`-${oldLine}`);
      emitted += 1;
    }
    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
      emitted += 1;
    }
    if (emitted >= MAX_DIFF_LINES) {
      lines.push(`... diff truncated at ${MAX_DIFF_LINES} changed lines`);
      break;
    }
  }

  if (emitted === 0) {
    lines.push("@@ no textual changes @@");
  }
  return lines.join("\n");
}

function splitLines(text: string): readonly string[] {
  if (text.length === 0) {
    return [];
  }
  return text.replace(/\n$/u, "").split("\n");
}
