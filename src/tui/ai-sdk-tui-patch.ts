import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const PATCH_MARKER = "/* harness-tools rich tui patch v3 */";

/** Applies narrow runtime patches to @ai-sdk/tui until upstream exposes renderer hooks. */
export async function patchAiSdkTuiRenderer(): Promise<void> {
  const require = createRequire(import.meta.url);
  const path = require.resolve("@ai-sdk/tui");
  const source = await readFile(path, "utf8");
  if (source.includes(PATCH_MARKER)) {
    return;
  }

  const alreadyPatched = source.includes("harness-tools rich tui patch");
  let patched = source.replace(/\/\* harness-tools rich tui patch(?: v\d+)? \*\/\n?/g, "");
  if (!alreadyPatched) {
    patched = replaceOnce(patched, originalRenderMarkdown(), patchedRenderMarkdown());
    patched = replaceOnce(
      patched,
      'topBorder(width, state.inputActive ? "Input" : "Status"),',
      'topBorder(width, state.inputActive ? "Chat prompt" : "Progress"),',
    );
    patched = replaceOnce(
      patched,
      'state.inputActive ? `> ${state.input}${state.inputCursorVisible === false ? " " : "\\u2588"}` : (_a = state.status) != null ? _a : "Streaming... \\u2191/\\u2193 scroll \\xB7 Ctrl+C quit",',
      'state.inputActive ? `› ${state.input}${state.inputCursorVisible === false ? " " : "\\u2588"}` : renderViewportProgress((_a = state.status) != null ? _a : "Streaming... \\u2191/\\u2193 scroll \\xB7 Ctrl+C quit", width),',
    );
    patched = replaceOnce(patched, originalBoxLine(), patchedBoxLine());
    patched = replaceOnce(
      patched,
      "  return visibleLines;\n};\nclampScrollOffset_fn = function(scrollOffset) {",
      addScrollBarPatch(),
    );
  }

  patched = replaceIfPresent(patched, originalTopBorder(), patchedTopBorder());
  patched = replaceIfPresent(patched, originalBottomBorder(), patchedBottomBorder());
  patched = replaceIfPresent(patched, currentViewportProgress(), patchedViewportProgress());
  patched = patched
    .replace('{ kind: "user", title: "User", content: prompt }', '{ kind: "user", title: "You", content: prompt }')
    .replace('title: "Assistant",', 'title: "Assistant · reply",')
    .replace('title: "Reasoning",', 'title: "Thinking",');
  await writeFile(path, `${PATCH_MARKER}\n${patched}`, "utf8");
}

function replaceOnce(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error("@ai-sdk/tui renderer patch failed: upstream source changed");
  }
  return source.replace(search, replacement);
}

function replaceIfPresent(source: string, search: string, replacement: string): string {
  return source.includes(search) ? source.replace(search, replacement) : source;
}

function originalRenderMarkdown(): string {
  return [
    "function renderMarkdown(input) {",
    "  var _a;",
    "  const lines = input.split(\"\\n\");",
    "  const output = [];",
    "  for (let index = 0; index < lines.length; index += 1) {",
    "    const table = parseTable(lines, index);",
    "    if (table != null) {",
    "      output.push(...renderTable(table));",
    "      index = table.endIndex - 1;",
    "      continue;",
    "    }",
    "    output.push(renderMarkdownLine((_a = lines[index]) != null ? _a : \"\"));",
    "  }",
    "  return output.join(\"\\n\");",
    "}",
  ].join("\n");
}

function patchedRenderMarkdown(): string {
  return [
    "function renderMarkdown(input) {",
    "  var _a;",
    "  const lines = input.split(\"\\n\");",
    "  const output = [];",
    "  let inCodeFence = false;",
    "  let codeLanguage = \"\";",
    "  for (let index = 0; index < lines.length; index += 1) {",
    "    const line = (_a = lines[index]) != null ? _a : \"\";",
    "    if (line.startsWith(\"```\")) {",
    "      inCodeFence = !inCodeFence;",
    "      codeLanguage = inCodeFence ? line.slice(3).trim() : \"\";",
    "      output.push(`${colors.tool}${ansi.bold}${inCodeFence ? `┌─ code${codeLanguage.length === 0 ? \"\" : ` ${codeLanguage}`} ` : \"└─ code\"}${ansi.boldOff}${colors.reset}`);",
    "      continue;",
    "    }",
    "    if (inCodeFence) {",
    "      output.push(`${colors.tool}│ ${line}${colors.reset}`);",
    "      continue;",
    "    }",
    "    const table = parseTable(lines, index);",
    "    if (table != null) {",
    "      output.push(...renderTable(table));",
    "      index = table.endIndex - 1;",
    "      continue;",
    "    }",
    "    output.push(renderMarkdownLine(line));",
    "  }",
    "  return output.join(\"\\n\");",
    "}",
  ].join("\n");
}

function originalTopBorder(): string {
  return [
    "function topBorder(width, title, rightTitle) {",
    "  const contentWidth = Math.max(0, width - 2);",
    "  const label = title ? sliceVisible(` ${title} `, contentWidth) : \"\";",
    "  const rightLabel = rightTitle ? sliceVisible(",
    "    ` ${rightTitle} `,",
    "    Math.max(0, contentWidth - visibleLength(label))",
    "  ) : \"\";",
    "  const remaining = Math.max(",
    "    0,",
    "    contentWidth - visibleLength(label) - visibleLength(rightLabel)",
    "  );",
    "  return `\\u250C${label}${horizontal.repeat(remaining)}${rightLabel}\\u2510`;",
    "}",
  ].join("\n");
}

function patchedTopBorder(): string {
  return [
    "function topBorder(width, title, rightTitle) {",
    "  const contentWidth = Math.max(0, width - 2);",
    "  const label = title ? sliceVisible(` ${title} `, contentWidth) : \"\";",
    "  const rightLabel = rightTitle ? sliceVisible(",
    "    ` ${rightTitle} `,",
    "    Math.max(0, contentWidth - visibleLength(label))",
    "  ) : \"\";",
    "  const remaining = Math.max(",
    "    0,",
    "    contentWidth - visibleLength(label) - visibleLength(rightLabel)",
    "  );",
    "  return `${colors.dim}\\u256D${colors.reset}${colors.tool}${label}${colors.reset}${colors.dim}${horizontal.repeat(remaining)}${colors.reset}${colors.tool}${rightLabel}${colors.reset}${colors.dim}\\u256E${colors.reset}`;",
    "}",
  ].join("\n");
}

function originalBottomBorder(): string {
  return [
    "function bottomBorder(width) {",
    "  return `\\u2514${horizontal.repeat(width - 2)}\\u2518`;",
    "}",
  ].join("\n");
}

function patchedBottomBorder(): string {
  return [
    "function bottomBorder(width) {",
    "  return `${colors.dim}\\u2570${horizontal.repeat(width - 2)}\\u256F${colors.reset}`;",
    "}",
  ].join("\n");
}

function currentViewportProgress(): string {
  return [
    "function renderViewportProgress(message, width) {",
    "  const contentWidth = Math.max(20, width - 4);",
    "  const barWidth = Math.max(8, Math.min(20, Math.floor(contentWidth / 5)));",
    "  const lower = message.toLowerCase();",
    "  const progress = lower.includes(\"executing\") ? 0.7 : lower.includes(\"processing\") ? 0.45 : lower.includes(\"streaming\") ? 0.25 : 1;",
    "  const filled = Math.max(1, Math.round(barWidth * progress));",
    "  const bar = `${colors.tool}${\"▰\".repeat(filled)}${colors.dim}${\"▱\".repeat(barWidth - filled)}${colors.reset}`;",
    "  return `${bar} ${colors.dim}scroll ↑/↓ PgUp/PgDn${colors.reset} · ${message}`;",
    "}",
  ].join("\n");
}

function patchedViewportProgress(): string {
  return [
    "function renderViewportProgress(message, width) {",
    "  const contentWidth = Math.max(20, width - 4);",
    "  const barWidth = Math.max(8, Math.min(24, Math.floor(contentWidth / 4)));",
    "  const lower = message.toLowerCase();",
    "  const progress = lower.includes(\"executing\") ? 0.7 : lower.includes(\"processing\") ? 0.45 : lower.includes(\"streaming\") ? 0.25 : 1;",
    "  const current = Math.round(progress * 100);",
    "  const bar = renderHarnessProgressBar(current, 100, barWidth);",
    "  return `${bar} ${colors.assistant}${String(current).padStart(3)}%${colors.reset} ${colors.dim}scroll ↑/↓ PgUp/PgDn${colors.reset} · ${message}`;",
    "}",
    "function renderHarnessProgressBar(current, total, width) {",
    "  const ratio = Math.max(0, Math.min(1, current / Math.max(1, total)));",
    "  const filled = Math.round(width * ratio);",
    "  const empty = width - filled;",
    "  let bar = \"\";",
    "  for (let index = 0; index < filled; index += 1) {",
    "    const t = filled > 1 ? index / (filled - 1) : ratio;",
    "    const red = Math.round(255 * (1 - t));",
    "    const green = Math.round(255 * t);",
    "    bar += `\\x1B[38;2;${red};${green};50m█`;",
    "  }",
    "  return `${bar}${colors.reset}${colors.dim}${\"░\".repeat(empty)}${colors.reset}`;",
    "}",
  ].join("\n");
}

function originalBoxLine(): string {
  return [
    "function boxLine(line, width) {",
    "  const contentWidth = width - 4;",
    "  const visible = sliceVisible(line, contentWidth);",
    "  const padding = \" \".repeat(",
    "    Math.max(0, contentWidth - visibleLength(visible))",
    "  );",
    "  return `\\u2502 ${visible}${padding} \\u2502`;",
    "}",
  ].join("\n");
}

function patchedBoxLine(): string {
  return [
    ...originalBoxLine().split("\n"),
    ...patchedViewportProgress().split("\n"),
  ].join("\n");
}

function addScrollBarPatch(): string {
  return [
    "  return addScrollBar(visibleLines, __privateMethod(this, _TerminalRenderer_instances, width_fn).call(this) - 4, totalLineCount, bodyContentHeight, __privateGet(this, _scrollOffset));",
    "};",
    "function addScrollBar(lines, width, totalLineCount, bodyContentHeight, scrollOffset) {",
    "  if (totalLineCount <= bodyContentHeight || lines.length === 0) {",
    "    return lines;",
    "  }",
    "  const maxOffset = Math.max(1, totalLineCount - bodyContentHeight);",
    "  const start = maxOffset - Math.min(maxOffset, Math.max(0, scrollOffset));",
    "  const thumb = Math.max(0, Math.min(lines.length - 1, Math.round(start / maxOffset * (lines.length - 1))));",
    "  const textWidth = Math.max(0, width - 1);",
    "  return lines.map((line, index) => {",
    "    const visible = sliceVisible(line, textWidth);",
    "    const padding = \" \".repeat(Math.max(0, textWidth - visibleLength(visible)));",
    "    return `${visible}${padding}${index === thumb ? \"█\" : \"│\"}`;",
    "  });",
    "}",
    "clampScrollOffset_fn = function(scrollOffset) {",
  ].join("\n");
}
