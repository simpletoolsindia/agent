import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const PATCH_MARKER = "/* harness-tools rich tui patch v6 */";

/**
 * Applies narrow runtime patches to @ai-sdk/tui until upstream exposes renderer hooks.
 *
 * Keep every replacement tiny and idempotent. This file is intentionally a
 * compatibility layer, not the source of business logic.
 */
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
  patched = stripHarnessToolHelpers(patched);
  patched = replaceIfPresent(patched, previousToolStatusLine(), originalToolStatusLine());
  patched = replaceIfPresent(patched, originalToolOutputContent(), patchedToolOutputContent());
  patched = replaceIfPresent(patched, originalToolStatusLine(), patchedToolStatusLine());
  if (!patched.includes("function formatHarnessToolFrame(")) {
    patched = replaceOnce(patched, "function shouldCollapsePart(message, partIndex, mode, displayModes) {", `${harnessToolOutputHelpers()}\nfunction shouldCollapsePart(message, partIndex, mode, displayModes) {`);
  }
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

function stripHarnessToolHelpers(source: string): string {
  return source.replace(/function formatHarnessTool(?:Frame|Output)\([\s\S]*?\nfunction shouldCollapsePart\(message, partIndex, mode, displayModes\) \{/u, "function shouldCollapsePart(message, partIndex, mode, displayModes) {");
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

function originalToolOutputContent(): string {
  return [
    "        content: `${inputText}",
    "",
    "Output:",
    "${formatValue(part.output)}`",
  ].join("\n");
}

function patchedToolOutputContent(): string {
  return '        content: formatHarnessToolOutput(toolName, inputText, part.output) ?? `${inputText}\\n\\nOutput:\\n${formatValue(part.output)}`';
}

function originalToolStatusLine(): string {
  return "  const status = toolStatus(part);";
}

function previousToolStatusLine(): string {
  return [
    "  const status = toolStatus(part);",
    "  if (options.collapsed && \"output\" in part) {",
    "    const harnessOutput = formatHarnessToolOutput(toolName, inputText, part.output);",
    "    if (harnessOutput !== void 0) {",
    "      return {",
    "        kind: \"tool\",",
    "        title,",
    "        rightTitle: status,",
    "        content: harnessOutput",
    "      };",
    "    }",
    "  }",
  ].join("\n");
}

function patchedToolStatusLine(): string {
  return [
    "  const status = toolStatus(part);",
    "  if (options.collapsed) {",
    "    const harnessFrame = formatHarnessToolFrame(toolName, inputText, part, status);",
    "    if (harnessFrame !== void 0) {",
    "      return {",
    "        kind: part.state === \"output-error\" || part.state === \"output-denied\" ? \"error\" : \"tool\",",
    "        title,",
    "        rightTitle: status,",
    "        content: harnessFrame",
    "      };",
    "    }",
    "  }",
  ].join("\n");
}


// Tool cards are rendered with one grammar across read/search/write/update/bash:
// `Icon Action: badge target ⟦status⟧` followed by bounded preview rows.
// Edit tools keep the user-requested `✎ Edit: 🟦 path ⟦+N/-M⟧` diff variant.
function harnessToolOutputHelpers(): string {
  return [
    "function formatHarnessToolFrame(toolName, inputText, part, status) {",
    "  if (\"output\" in part) {",
    "    return formatHarnessToolOutput(toolName, inputText, part.output);",
    "  }",
    "  if (part.state === \"output-error\") {",
    "    return formatHarnessFrame(toolName, void 0, status, [`error: ${part.errorText}`]);",
    "  }",
    "  if (part.state === \"output-denied\") {",
    "    const reason = part.approval && typeof part.approval.reason === \"string\" ? part.approval.reason : \"denied\";",
    "    return formatHarnessFrame(toolName, toolInputTarget(toolName, \"input\" in part ? part.input : void 0), status, [`reason: ${reason}`]);",
    "  }",
    "  return formatHarnessFrame(toolName, toolInputTarget(toolName, \"input\" in part ? part.input : void 0), status, harnessInputRows(\"input\" in part ? part.input : void 0));",
    "}",
    "function formatHarnessToolOutput(toolName, inputText, output) {",
    "  const payload = harnessToolPayload(output);",
    "  const change = payload && typeof payload.change === \"object\" && payload.change !== null ? payload.change : void 0;",
    "  const diff = typeof (change == null ? void 0 : change.diff) === \"string\" ? change.diff : \"\";",
    "  if ((toolName === \"write\" || toolName === \"update\") && diff.length > 0) {",
    "    const path = typeof (payload == null ? void 0 : payload.path) === \"string\" ? payload.path : typeof (change == null ? void 0 : change.path) === \"string\" ? change.path : \"\";",
    "    const added = typeof change.addedLines === \"number\" ? change.addedLines : countHarnessDiff(diff).added;",
    "    const removed = typeof change.removedLines === \"number\" ? change.removedLines : countHarnessDiff(diff).removed;",
    "    return formatHarnessDiffFrame(path, diff, added, removed);",
    "  }",
    "  return formatHarnessFrame(toolName, toolOutputTarget(toolName, payload), toolOutputStatus(toolName, payload), harnessOutputRows(toolName, payload, output));",
    "}",
    "function harnessToolPayload(output) {",
    "  if (typeof output !== \"object\" || output === null) {",
    "    return void 0;",
    "  }",
    "  if (output.ok === true && typeof output.output === \"object\" && output.output !== null) {",
    "    return output.output;",
    "  }",
    "  return output;",
    "}",
    "function formatHarnessFrame(toolName, target, status, rows) {",
    "  const meta = harnessToolMeta(toolName);",
    "  const safeTarget = target === void 0 || target.length === 0 ? toolName : target;",
    "  return [`${meta.icon} ${meta.label}: ${meta.badge} ${sliceMiddle(safeTarget, 38)} ⟦${status}⟧ ╮`, ...rows.slice(0, 18).map((row) => `│${row}`), \"╯\"].join(\"\\n\");",
    "}",
    "function formatHarnessDiffFrame(path, diff, added, removed) {",
    "  const title = `✎ Edit: 🟦 ${sliceMiddle(path, 38)} ⟦+${added}/-${removed}⟧ ╮`;",
    "  const rows = harnessDiffRows(diff);",
    "  return [title, ...rows, \"╯\"].join(\"\\n\");",
    "}",
    "function harnessToolMeta(toolName) {",
    "  switch (toolName) {",
    "    case \"read\": return { icon: \"◉\", label: \"Read\", badge: \"🟦\" };",
    "    case \"search\": return { icon: \"⌕\", label: \"Search\", badge: \"🟨\" };",
    "    case \"bash\": return { icon: \"▶\", label: \"Bash\", badge: \"🟪\" };",
    "    case \"write\":",
    "    case \"update\": return { icon: \"✎\", label: \"Edit\", badge: \"🟦\" };",
    "    case \"subagent\": return { icon: \"◇\", label: \"Agent\", badge: \"🟩\" };",
    "    default: return { icon: \"◆\", label: toolName, badge: \"⬜\" };",
    "  }",
    "}",
    "function toolInputTarget(toolName, input) {",
    "  if (typeof input !== \"object\" || input === null) return toolName;",
    "  if (typeof input.path === \"string\") return input.path;",
    "  if (typeof input.command === \"string\") return input.command;",
    "  if (typeof input.query === \"string\") return input.query;",
    "  if (typeof input.taskGoal === \"string\") return input.taskGoal;",
    "  return toolName;",
    "}",
    "function toolOutputTarget(toolName, payload) {",
    "  if (typeof payload !== \"object\" || payload === null) return toolName;",
    "  if (typeof payload.path === \"string\") return payload.path;",
    "  if (typeof payload.command === \"string\") return payload.command;",
    "  return toolName;",
    "}",
    "function toolOutputStatus(toolName, payload) {",
    "  if (toolName === \"search\" && payload && Array.isArray(payload.matches)) return `${payload.matches.length} matches`;",
    "  if (toolName === \"read\" && payload && typeof payload.lineCount === \"number\") return `${payload.lineCount} lines`;",
    "  if (toolName === \"bash\" && payload && typeof payload.exitCode === \"number\") return `exit ${payload.exitCode}`;",
    "  if (payload && typeof payload.applied === \"number\") return `${payload.applied} edits`;",
    "  return \"done\";",
    "}",
    "function harnessInputRows(input) {",
    "  if (input === void 0) return [\"   …│input streaming\"];",
    "  return formatValue(input).split(\"\\n\").slice(0, 6).map((line, index) => `${String(index + 1).padStart(4)}│${sliceVisible(line, 72)}`);",
    "}",
    "function harnessOutputRows(toolName, payload, rawOutput) {",
    "  if (toolName === \"search\" && payload && Array.isArray(payload.matches)) {",
    "    return payload.matches.slice(0, 6).map((match) => `${String(match.line || \"?\").padStart(4)}│${sliceVisible(`${match.path || \"\"}: ${match.text || \"\"}`, 72)}`);",
    "  }",
    "  if (toolName === \"bash\" && payload && typeof payload.stdout === \"string\" && payload.stdout.length > 0) {",
    "    return payload.stdout.split(\"\\n\").slice(0, 6).map((line, index) => `${String(index + 1).padStart(4)}│${sliceVisible(line, 72)}`);",
    "  }",
    "  return formatValue(payload == null ? rawOutput : payload).split(\"\\n\").slice(0, 6).map((line, index) => `${String(index + 1).padStart(4)}│${sliceVisible(line, 72)}`);",
    "}",
    "function harnessDiffRows(diff) {",
    "  const rows = [];",
    "  let oldLine = 1;",
    "  for (const line of diff.split(\"\\n\")) {",
    "    if (line.startsWith(\"---\") || line.startsWith(\"+++\") || line.startsWith(\"@@\") || line.startsWith(\"...\")) {",
    "      continue;",
    "    }",
    "    if (line.startsWith(\"-\")) {",
    "      rows.push(`│${`-${oldLine}`.padStart(4)}│${sliceVisible(line.slice(1), 72)}`);",
    "      oldLine += 1;",
    "    } else if (line.startsWith(\"+\")) {",
    "      rows.push(`│${\"+\".padStart(4)}│${sliceVisible(line.slice(1), 72)}`);",
    "    }",
    "    if (rows.length >= 18) {",
    "      rows.push(\"│   …│diff preview truncated\");",
    "      break;",
    "    }",
    "  }",
    "  return rows.length === 0 ? [\"│   =│no textual changes\"] : rows;",
    "}",
    "function countHarnessDiff(diff) {",
    "  let added = 0;",
    "  let removed = 0;",
    "  for (const line of diff.split(\"\\n\")) {",
    "    if (line.startsWith(\"+\") && !line.startsWith(\"+++\")) added += 1;",
    "    if (line.startsWith(\"-\") && !line.startsWith(\"---\")) removed += 1;",
    "  }",
    "  return { added, removed };",
    "}",
    "function sliceMiddle(text, width) {",
    "  if (visibleLength(text) <= width) {",
    "    return text;",
    "  }",
    "  const left = Math.max(4, Math.floor((width - 1) / 2));",
    "  const right = Math.max(4, width - left - 1);",
    "  return `${sliceVisible(text, left)}…${text.slice(Math.max(0, text.length - right))}`;",
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
