import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const PATCH_MARKER = "/* harness-tools rich tui patch v17 */";

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
  patched = replaceIfPresent(patched, originalPinkToolColor(), patchedToolColor());
  patched = replaceIfPresent(patched, originalBottomBorder(), patchedBottomBorder());
  patched = replaceIfPresent(patched, currentViewportProgress(), patchedViewportProgress());
  patched = replaceIfPresent(patched, currentScreenViewport(), patchedScreenViewport());
  patched = replaceIfPresent(patched, originalBodyContentHeight(), patchedBodyContentHeight());
  patched = replaceIfPresent(patched, originalActiveControls(), patchedActiveControls());
  patched = replaceIfPresent(patched, originalInterruptedStatus(), patchedInterruptedStatus());
  patched = replaceIfPresent(patched, originalInterruptedStopCondition(), patchedInterruptedStopCondition());
  patched = replaceIfPresent(patched, originalInterruptedRunnerCatch(), patchedInterruptedRunnerCatch());
  patched = replaceIfPresent(patched, originalPromptMenu(), patchedPromptMenu());
  patched = replaceIfPresent(patched, originalReadPromptInitialInput(), patchedReadPromptInitialInput());
  patched = replaceIfPresent(patched, originalReadPromptCharacterInput(), patchedReadPromptCharacterInput());
  patched = replaceIfPresent(patched, originalReadPromptSubmit(), patchedReadPromptSubmit());
  patched = replaceIfPresent(patched, originalReadPromptHistoryNavigation(), patchedReadPromptHistoryNavigation());
  if (!patched.includes("const harnessPromptHistory = []")) {
    patched = replaceOnce(patched, "function parseKey(chunk) {", `${harnessPromptHelpers()}\nfunction parseKey(chunk) {`);
  }
  patched = replaceIfPresent(patched, originalParseKeyDefault(), patchedParseKeyDefault());
  patched = stripHarnessToolHelpers(patched);
  patched = stripHarnessToolStatusBlocks(patched);
  patched = replaceIfPresent(patched, previousToolStatusLine(), originalToolStatusLine());
  patched = replaceIfPresent(patched, originalToolOutputContent(), patchedToolOutputContent());
  patched = replaceIfPresent(patched, originalReasoningSection("Reasoning"), patchedReasoningSection());
  patched = replaceIfPresent(patched, originalReasoningSection("Thinking"), patchedReasoningSection());
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

function stripHarnessToolStatusBlocks(source: string): string {
  return source.replace(
    /  if \(options\.collapsed\) \{\n    const harnessFrame = formatHarnessToolFrame\(toolName, inputText, part, status\);\n    if \(harnessFrame !== void 0\) \{\n      return \{\n        kind: part\.state === "output-error" \|\| part\.state === "output-denied" \? "error" : "tool",\n        title,\n        rightTitle: status,\n        content: harnessFrame\n      \};\n    \}\n  \}\n/gu,
    "",
  );
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
    "      if (inCodeFence) {",
    "        output.push(renderHarnessCodeFenceBottom());",
    "        inCodeFence = false;",
    "      } else {",
    "        inCodeFence = true;",
    "        codeLanguage = line.slice(3).trim();",
    "        output.push(renderHarnessCodeFenceTop(codeLanguage));",
    "      }",
    "      continue;",
    "    }",
    "    if (inCodeFence) {",
    "      output.push(renderHarnessCodeFenceLine(line));",
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
    "  if (inCodeFence) {",
    "    output.push(renderHarnessCodeFenceBottom());",
    "  }",
    "  return output.join(\"\\n\");",
    "}",
    "function renderHarnessCodeFenceTop(language) {",
    "  const label = language.length === 0 ? \" code \" : ` code · ${language} `;",
    "  const width = 74;",
    "  return `${colors.dim}╭─${colors.reset}${colors.reasoning}${ansi.bold}${label}${ansi.boldOff}${colors.reset}${colors.dim}${\"─\".repeat(Math.max(0, width - visibleLength(label) - 2))}╮${colors.reset}`;",
    "}",
    "function renderHarnessCodeFenceLine(line) {",
    "  const width = 72;",
    "  const text = sliceVisible(line, width);",
    "  const padding = \" \".repeat(Math.max(0, width - visibleLength(text)));",
    "  return `${colors.dim}│${colors.reset} ${colors.reasoning}${text}${colors.reset}${padding} ${colors.dim}│${colors.reset}`;",
    "}",
    "function renderHarnessCodeFenceBottom() {",
    "  return `${colors.dim}╰${\"─\".repeat(73)}╯${colors.reset}`;",
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

function originalPinkToolColor(): string {
  return '  tool: "\\x1B[95m",';
}

function patchedToolColor(): string {
  return '  tool: "\\x1B[36m",';
}

function currentScreenViewport(): string {
  return [
    "function renderScreenViewport(state) {",
    "  var _a;",
    "  const width = Math.max(20, state.width);",
    "  const height = Math.max(8, state.height);",
    "  const inputHeight = 3;",
    "  const bodyHeight = height - inputHeight;",
    "  const bodyContentHeight = bodyHeight - 2;",
    "  const visibleBody = state.visibleBodyLines.slice(0, bodyContentHeight);",
    "  while (visibleBody.length < bodyContentHeight) {",
    "    visibleBody.push(\"\");",
    "  }",
    "  const lines = [",
    "    topBorder(width, state.title, state.rightTitle),",
    "    ...visibleBody.map((line) => boxLine(line, width)),",
    "    bottomBorder(width),",
    "    topBorder(width, state.inputActive ? \"Chat prompt\" : \"Progress\"),",
    "    boxLine(",
    "      state.inputActive ? `› ${state.input}${state.inputCursorVisible === false ? \" \" : \"\\u2588\"}` : renderViewportProgress((_a = state.status) != null ? _a : \"Streaming... \\u2191/\\u2193 scroll \\xB7 Ctrl+C quit\", width),",
    "      width",
    "    ),",
    "    bottomBorder(width)",
    "  ];",
    "  return lines.join(\"\\n\");",
    "}",
  ].join("\n");
}

function patchedScreenViewport(): string {
  return [
    "function renderScreenViewport(state) {",
    "  var _a;",
    "  const width = Math.max(20, state.width);",
    "  const height = Math.max(8, state.height);",
    "  const bodyContentHeight = Math.max(1, height - 2);",
    "  const visibleBody = state.visibleBodyLines.slice(0, bodyContentHeight);",
    "  while (visibleBody.length < bodyContentHeight) {",
    "    visibleBody.push(\"\");",
    "  }",
    "  const bottom = state.inputActive ? renderPromptMenu(state.input, state.inputCursorVisible, width) : renderViewportProgress((_a = state.status) != null ? _a : \"Streaming... \\u2191/\\u2193 scroll \\xB7 Ctrl+C quit\", width);",
    "  const lines = [",
    "    topBorder(width, state.title, state.rightTitle),",
    "    ...visibleBody.map((line) => boxLine(line, width)),",
    "    bottomMenuLine(bottom, width)",
    "  ];",
    "  return lines.join(\"\\n\");",
    "}",
  ].join("\n");
}

function originalBodyContentHeight(): string {
  return [
    "bodyContentHeight_fn = function() {",
    "  return Math.max(1, __privateMethod(this, _TerminalRenderer_instances, height_fn).call(this) - 5);",
    "};",
  ].join("\n");
}

function patchedBodyContentHeight(): string {
  return [
    "bodyContentHeight_fn = function() {",
    "  return Math.max(1, __privateMethod(this, _TerminalRenderer_instances, height_fn).call(this) - 2);",
    "};",
  ].join("\n");
}

function currentViewportProgress(): string {
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

function patchedViewportProgress(): string {
  return [
    "function renderViewportProgress(message, width) {",
    "  const contentWidth = Math.max(20, width - 2);",
    "  const lower = message.toLowerCase();",
    "  const busy = lower.includes(\"executing\") || lower.includes(\"processing\") || lower.includes(\"streaming\") || lower.includes(\"running\");",
    "  const progress = lower.includes(\"executing\") ? 0.72 : lower.includes(\"processing\") ? 0.48 : lower.includes(\"streaming\") ? 0.32 : busy ? 0.62 : 1;",
    "  const spinnerFrames = [\"⠋\", \"⠙\", \"⠹\", \"⠸\", \"⠼\", \"⠴\", \"⠦\", \"⠧\", \"⠇\", \"⠏\"];",
    "  const spinner = busy ? spinnerFrames[Math.floor(Date.now() / 120) % spinnerFrames.length] : \"✓\";",
    "  const barWidth = Math.max(8, Math.min(18, Math.floor(contentWidth / 5)));",
    "  const bar = renderHarnessProgressBar(progress, barWidth);",
    "  const inSubagent = lower.includes(\"subagent running\");",
    "  const tip = inSubagent ? \"\" : busy ? \" · Esc interrupt · ↑/↓ scroll\" : \" · Enter prompt · ↑/↓ history\";",
    "  return `${colors.reasoning}${spinner}${colors.reset} ${bar} ${colors.assistant}${message}${colors.reset}${colors.dim}${tip}${colors.reset}`;",
    "}",
    "function renderPromptMenu(input, inputCursorVisible, width) {",
    "  const cursor = inputCursorVisible === false ? \" \" : \"█\";",
    "  const displayInput = formatHarnessPromptInput(input);",
    "  return `${colors.user}›${colors.reset} ${displayInput}${cursor} ${colors.dim}· Enter send · ↑/↓ history · paste ok${colors.reset}`;",
    "}",
    "function formatHarnessPromptInput(input) {",
    "  const lines = String(input).split(/\\r?\\n/);",
    "  if (lines.length > 3) {",
    "    return `${colors.reasoning}[pasted context]${colors.reset}${colors.dim} ${lines.length} lines · ${visibleLength(input).toLocaleString()} chars${colors.reset}`;",
    "  }",
    "  return lines.join(`${colors.dim} ↵ ${colors.reset}`);",
    "}",
    "function bottomMenuLine(content, width) {",
    "  const inner = Math.max(0, width - 2);",
    "  const visible = sliceVisible(content, inner);",
    "  const padding = \" \".repeat(Math.max(0, inner - visibleLength(visible)));",
    "  return `${colors.dim}╰${colors.reset}${visible}${padding}${colors.dim}╯${colors.reset}`;",
    "}",
    "function renderHarnessProgressBar(progress, width) {",
    "  const filled = Math.max(1, Math.round(Math.max(0, Math.min(1, progress)) * width));",
    "  const empty = Math.max(0, width - filled);",
    "  return `${colors.dim}▐${colors.reset}${colors.reasoning}${\"█\".repeat(filled)}${colors.dim}${\"░\".repeat(empty)}${colors.reset}${colors.dim}▌${colors.reset}`;",
    "}",
  ].join("\n");
}

function originalActiveControls(): string {
  return 'var activeControls = "↑/↓ · PgUp/PgDn · Esc/Ctrl+C";';
}

function patchedActiveControls(): string {
  return 'var activeControls = "↑/↓ scroll · PgUp/PgDn · Esc/Ctrl+C interrupt";';
}

function originalInterruptedStatus(): string {
  return '__privateSet(this, _status, __privateGet(this, _interrupted) ? "Interrupted" : (options == null ? void 0 : options.continueSession) ? `Done \\xB7 Enter another prompt \\xB7 ${activeControls}` : `Done \\xB7 ${doneControls}`);';
}

function patchedInterruptedStatus(): string {
  return '__privateSet(this, _status, __privateGet(this, _interrupted) ? "Interrupted · type what should happen next" : (options == null ? void 0 : options.continueSession) ? `Done \\xB7 Enter another prompt \\xB7 ${activeControls}` : `Done \\xB7 ${doneControls}`);';
}

function originalInterruptedStopCondition(): string {
  return "      if (__privateGet(this, _interrupted) || !(options == null ? void 0 : options.continueSession)) {";
}

function patchedInterruptedStopCondition(): string {
  return "      if (!(options == null ? void 0 : options.continueSession)) {";
}

function originalInterruptedRunnerCatch(): string {
  return [
    "          upsertResponseMessage(messages, responseMessage, streamWithoutPrompt);",
    "        }",
    "      } catch (error) {",
    "        if (isInterruptedError(error)) {",
    "          return;",
    "        }",
    "        throw error;",
    "      }",
  ].join("\n");
}

function patchedInterruptedRunnerCatch(): string {
  return [
    "          upsertResponseMessage(messages, responseMessage, streamWithoutPrompt);",
    "        }",
    "      } catch (error) {",
    "        if (isInterruptedError(error)) {",
    "          if (!this.renderer.readPrompt) {",
    "            return;",
    "          }",
    "          try {",
    "            prompt = await this.renderer.readPrompt({",
    "              title,",
    "              initialPrompt: \"\"",
    "            });",
    "          } catch (nextError) {",
    "            if (isInterruptedError(nextError)) {",
    "              return;",
    "            }",
    "            throw nextError;",
    "          }",
    "          if (prompt == null) {",
    "            return;",
    "          }",
    "          streamWithoutPrompt = false;",
    "          continue;",
    "        }",
    "        throw error;",
    "      }",
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

function originalReasoningSection(title: "Reasoning" | "Thinking"): string {
  return [
    "      case \"reasoning\": {",
    "        const content = part.text.trim();",
    "        if (displayModes.reasoning === \"hidden\" || content.length === 0) {",
    "          break;",
    "        }",
    "        activeSectionIds.add(id);",
    "        __privateMethod(this, _TerminalRenderer_instances, upsertSection_fn).call(this, {",
    "          id,",
    "          kind: \"reasoning\",",
    `          title: "${title}",`,
    "          content,",
    "          collapsed: shouldCollapsePart(",
    "            message,",
    "            index,",
    "            displayModes.reasoning,",
    "            displayModes",
    "          )",
    "        });",
    "        break;",
    "      }",
  ].join("\n");
}

function patchedReasoningSection(): string {
  return [
    "      case \"reasoning\": {",
    "        const rawContent = part.text.trim();",
    "        if (displayModes.reasoning === \"hidden\") {",
    "          break;",
    "        }",
    "        const content = rawContent.length === 0 ? \"Thinking…\" : rawContent;",
    "        const collapsed = shouldCollapsePart(",
    "          message,",
    "          index,",
    "          displayModes.reasoning,",
    "          displayModes",
    "        );",
    "        activeSectionIds.add(id);",
    "        __privateMethod(this, _TerminalRenderer_instances, upsertSection_fn).call(this, {",
    "          id,",
    "          kind: \"reasoning\",",
    "          title: \"Think · live\",",
    "          rightTitle: collapsed ? \"queued\" : \"streaming\",",
    "          content: formatHarnessReasoningFrame(content),",
    "          collapsed",
    "        });",
    "        break;",
    "      }",
  ].join("\n");
}


// Reasoning and tool surfaces share one narrow box grammar so the stream
// stays scannable while content updates in place.


// Tool cards are rendered with one grammar across read/search/write/update/bash:
// `Icon Action: badge target ⟦status⟧` followed by bounded preview rows.
// Edit tools keep the user-requested `✎ Edit: 🟦 path ⟦+N/-M⟧` diff variant.
function harnessToolOutputHelpers(): string {
  return [
    "function formatHarnessToolFrame(toolName, inputText, part, status) {",
    "  if (\"output\" in part) {",
    "    return formatHarnessToolOutput(toolName, inputText, part.output);",
    "  }",
    "  if (toolName === \"subagent\") {",
    "    return formatHarnessSubagentFrame(part, status);",
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
    "function formatHarnessReasoningFrame(content) {",
    "  const cleanLines = content.split(\"\\n\").map((line) => line.trim()).filter((line) => line.length > 0);",
    "  const visibleLines = cleanLines.length === 0 ? [\"Thinking…\"] : cleanLines.slice(-8);",
    "  const rows = visibleLines.map((line, index) => `${index === visibleLines.length - 1 ? \"→\" : \"·\"} ${line}`);",
    "  rows.push(\"⟦live reasoning stream⟧\");",
    "  return renderHarnessOutputBox(\"◌ Thinking: live reasoning ⟦streaming⟧\", \"Reasoning\", rows);",
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
    "  if (toolName === \"bash\" && payload && typeof payload === \"object\") {",
    "    return formatHarnessBashFrame(payload, output);",
    "  }",
    "  if (toolName === \"subagent\" && payload && typeof payload === \"object\") {",
    "    return formatHarnessSubagentResultFrame(payload, output);",
    "  }",
    "  if (toolName === \"todo\" && payload && typeof payload === \"object\") {",
    "    return formatHarnessTodoFrame(payload);",
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
    "  return renderHarnessOutputBox(`${meta.icon} ${meta.label}: ${meta.badge} ${sliceMiddle(safeTarget, 36)} ⟦${status}⟧`, \"Output\", rows.slice(0, 18));",
    "}",
    "function formatHarnessDiffFrame(path, diff, added, removed) {",
    "  const command = `✎ Edit: 🟦 ${sliceMiddle(path, 40)} ⟦+${added}/-${removed}⟧`;",
    "  return renderHarnessOutputBox(command, \"Diff\", harnessDiffRows(diff));",
    "}",
    "function formatHarnessBashFrame(payload, output) {",
    "  const command = typeof payload.command === \"string\" ? payload.command : \"bash\";",
    "  const cwd = typeof payload.cwd === \"string\" && payload.cwd.length > 0 && payload.cwd !== \".\" ? `cd ${payload.cwd} && ` : \"\";",
    "  const rows = [];",
    "  if (typeof payload.stdout === \"string\" && payload.stdout.length > 0) {",
    "    rows.push(...payload.stdout.split(\"\\n\").filter((line) => line.length > 0).slice(0, 12));",
    "  }",
    "  if (typeof payload.stderr === \"string\" && payload.stderr.length > 0) {",
    "    rows.push(...payload.stderr.split(\"\\n\").filter((line) => line.length > 0).slice(0, 6));",
    "  }",
    "  const elapsed = output && typeof output === \"object\" && typeof output.elapsedMs === \"number\" ? `Wall: ${Math.max(0, output.elapsedMs / 1000).toFixed(2)}s` : void 0;",
    "  const timeoutMs = typeof payload.timeoutMs === \"number\" ? payload.timeoutMs : 10000;",
    "  const timeout = `Timeout: ${Math.max(0.001, timeoutMs / 1000).toFixed(timeoutMs % 1000 === 0 ? 0 : 2)}s`;",
    "  const footer = `⟦${[elapsed, timeout].filter(Boolean).join(\" | \")}⟧`;",
    "  return renderHarnessOutputBox(`$ ${cwd}${command}`, \"Output\", [...rows, footer]);",
    "}",
    "function formatHarnessSubagentFrame(part, status) {",
    "  const input = \"input\" in part && typeof part.input === \"object\" && part.input !== null ? part.input : {};",
    "  const role = typeof input.role === \"string\" ? input.role : \"research\";",
    "  const goal = typeof input.taskGoal === \"string\" ? input.taskGoal : \"waiting for task\";",
    "  const refs = Array.isArray(input.referenceFiles) ? `${input.referenceFiles.length} references` : \"search/read only\";",
    "  return renderHarnessOutputBox(`◇ Subagent: ${role} ⟦${status}⟧`, \"Live status\", [`Running: ${sliceMiddle(goal, 48)}`, `Doing: ${role} via search/read`, `Status: ${status}`, `Scope: ${refs}`, \"Interrupt: Esc/Ctrl+C → prompt\"]);",
    "}",
    "function formatHarnessSubagentResultFrame(payload, output) {",
    "  const role = typeof payload.role === \"string\" ? payload.role : \"research\";",
    "  const goal = typeof payload.taskGoal === \"string\" ? payload.taskGoal : \"subagent\";",
    "  const summary = typeof payload.summary === \"string\" ? payload.summary : formatHarnessValue(payload);",
    "  const elapsed = output && typeof output === \"object\" && typeof output.elapsedMs === \"number\" ? `Wall: ${Math.max(0, output.elapsedMs / 1000).toFixed(2)}s` : void 0;",
    "  const rows = [`Goal: ${sliceMiddle(goal, 48)}`, ...summary.split(\"\\n\").filter((line) => line.length > 0).slice(0, 10)];",
    "  if (payload.summaryTruncated === true) rows.push(\"⟦summary compacted for main context⟧\");",
    "  if (elapsed !== void 0) rows.push(`⟦${elapsed}⟧`);",
    "  return renderHarnessOutputBox(`◇ Subagent: ${role} ⟦done⟧`, \"Result\", rows);",
    "}",
    "function formatHarnessTodoFrame(payload) {",
    "  const phases = Array.isArray(payload.phases) ? payload.phases : Array.isArray(payload.list) ? payload.list : [];",
    "  if (phases.length === 0) {",
    "    return renderHarnessOutputBox(\"☑ Todo\", \"Tasks\", harnessOutputRows(\"todo\", payload, payload));",
    "  }",
    "  const totals = todoTotals(phases);",
    "  const current = typeof payload.current === \"string\" ? payload.current : activeTodoText(phases);",
    "  const rows = [];",
    "  rows.push(current === void 0 ? \"Current: none\" : `Current: ${sliceMiddle(current, 48)}`);",
    "  rows.push(`Pending: ${totals.pending}  Done: ${totals.done}/${totals.total}`);",
    "  phases.slice(0, 6).forEach((phase, phaseIndex) => {",
    "    const items = Array.isArray(phase.items) ? phase.items : Array.isArray(phase.tasks) ? phase.tasks : [];",
    "    const phaseTotals = todoTotals([phase]);",
    "    const roman = [\"I\", \"II\", \"III\", \"IV\", \"V\", \"VI\"][phaseIndex] || String(phaseIndex + 1);",
    "    const name = typeof phase.phase === \"string\" ? phase.phase : typeof phase.name === \"string\" ? phase.name : typeof phase.title === \"string\" ? phase.title : `Phase ${phaseIndex + 1}`;",
    "    rows.push(`${roman}. ${name}  ${phaseTotals.done}/${phaseTotals.total}`);",
    "    items.slice(0, phaseIndex >= 2 ? 2 : 8).forEach((item, itemIndex) => {",
    "      const status = todoStatus(item);",
    "      const text = todoText(item);",
    "      const branch = itemIndex === Math.min(items.length, phaseIndex >= 2 ? 2 : 8) - 1 ? \"└─\" : \"├─\";",
    "      rows.push(`  ${branch} ${todoStatusIcon(status)} ${text}`);",
    "    });",
    "  });",
    "  return renderHarnessTodoBox(`☑ Todo ${totals.done}/${totals.total} done`, rows);",
    "}",
    "function todoTotals(phases) {",
    "  let done = 0;",
    "  let pending = 0;",
    "  let total = 0;",
    "  for (const phase of phases) {",
    "    const items = Array.isArray(phase.items) ? phase.items : Array.isArray(phase.tasks) ? phase.tasks : [];",
    "    for (const item of items) {",
    "      const status = todoStatus(item);",
    "      total += 1;",
    "      if (status === \"done\") done += 1; else pending += 1;",
    "    }",
    "  }",
    "  return { done, pending, total };",
    "}",
    "function activeTodoText(phases) {",
    "  for (const phase of phases) {",
    "    const items = Array.isArray(phase.items) ? phase.items : Array.isArray(phase.tasks) ? phase.tasks : [];",
    "    const phaseName = typeof phase.phase === \"string\" ? phase.phase : typeof phase.name === \"string\" ? phase.name : typeof phase.title === \"string\" ? phase.title : \"Todo\";",
    "    for (const item of items) {",
    "      if (todoStatus(item) === \"in_progress\") return `${phaseName}: ${todoText(item)}`;",
    "    }",
    "  }",
    "  return void 0;",
    "}",
    "function todoStatus(item) {",
    "  if (item && typeof item === \"object\") {",
    "    if (item.done === true || item.completed === true || item.status === \"done\") return \"done\";",
    "    if (item.status === \"in_progress\" || item.status === \"in-progress\" || item.status === \"active\") return \"in_progress\";",
    "    if (item.status === \"blocked\") return \"blocked\";",
    "  }",
    "  return \"pending\";",
    "}",
    "function todoText(item) {",
    "  return typeof item === \"string\" ? item : typeof (item == null ? void 0 : item.task) === \"string\" ? item.task : typeof (item == null ? void 0 : item.text) === \"string\" ? item.text : typeof (item == null ? void 0 : item.title) === \"string\" ? item.title : \"task\";",
    "}",
    "function todoStatusIcon(status) {",
    "  return status === \"done\" ? \"☑\" : status === \"in_progress\" ? \"▶\" : status === \"blocked\" ? \"⏸\" : \"☐\";",
    "}",
    "function renderHarnessOutputBox(command, label, rows) {",
    "  const width = 61;",
    "  const inner = width - 2;",
    "  const body = rows.length === 0 ? [\"(no output)\"] : rows.slice(0, 20);",
    "  return [`╭${\"─\".repeat(inner)}╮`, harnessBoxLine(command, inner), harnessSeparator(label, inner), ...body.map((row) => harnessBoxLine(row, inner)), `╰${\"─\".repeat(inner)}╯`].join(\"\\n\");",
    "}",
    "function renderHarnessTodoBox(title, rows) {",
    "  const width = 61;",
    "  const inner = width - 2;",
    "  const titleText = `─── ${title} `;",
    "  const top = `${titleText}${\"─\".repeat(Math.max(0, inner - visibleLength(titleText)))}╮`;",
    "  return [top, ...rows.slice(0, 20).map((row) => harnessBoxLine(row, inner)), `╰${\"─\".repeat(inner)}╯`].join(\"\\n\");",
    "}",
    "function harnessSeparator(label, width) {",
    "  const title = `─── ${label} `;",
    "  return `├${title}${\"─\".repeat(Math.max(0, width - visibleLength(title)))}┤`;",
    "}",
    "function harnessBoxLine(text, width) {",
    "  const visible = sliceVisible(String(text), width);",
    "  const padding = \" \".repeat(Math.max(0, width - visibleLength(visible)));",
    "  return `│${visible}${padding}│`;",
    "}",
    "function harnessToolMeta(toolName) {",
    "  switch (toolName) {",
    "    case \"read\": return { icon: \"◉\", label: \"Read\", badge: \"🟦\" };",
    "    case \"search\": return { icon: \"⌕\", label: \"Search\", badge: \"🟨\" };",
    "    case \"bash\": return { icon: \"▶\", label: \"Bash\", badge: \"🟪\" };",
    "    case \"write\":",
    "    case \"update\": return { icon: \"✎\", label: \"Edit\", badge: \"🟦\" };",
    "    case \"todo\": return { icon: \"☑\", label: \"Todo\", badge: \"🟩\" };",
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
    "  if (input === void 0) return [\"input streaming\"];",
    "  return formatHarnessValue(input).split(\"\\n\").slice(0, 6).map((line, index) => `${String(index + 1).padStart(4)}│${sliceVisible(line, 72)}`);",
    "}",
    "function harnessOutputRows(toolName, payload, rawOutput) {",
    "  if (toolName === \"search\" && payload && Array.isArray(payload.matches)) {",
    "    return payload.matches.slice(0, 6).map((match) => `${String(match.line || \"?\").padStart(4)}│${sliceVisible(`${match.path || \"\"}: ${match.text || \"\"}`, 72)}`);",
    "  }",
    "  return formatHarnessValue(payload == null ? rawOutput : payload).split(\"\\n\").slice(0, 6).map((line, index) => `${String(index + 1).padStart(4)}│${sliceVisible(line, 72)}`);",
    "}",
    "function formatHarnessValue(value) {",
    "  const formatted = formatValue(value);",
    "  if (typeof formatted === \"string\") {",
    "    return formatted;",
    "  }",
    "  return value === void 0 ? \"\" : String(value);",
    "}",
    "function harnessDiffRows(diff) {",
    "  const rows = [];",
    "  let oldLine = 1;",
    "  for (const line of diff.split(\"\\n\")) {",
    "    if (line.startsWith(\"---\") || line.startsWith(\"+++\") || line.startsWith(\"@@\") || line.startsWith(\"...\")) {",
    "      continue;",
    "    }",
    "    if (line.startsWith(\"-\")) {",
    "      rows.push(`${`-${oldLine}`.padStart(4)}│${sliceVisible(line.slice(1), 72)}`);",
    "      oldLine += 1;",
    "    } else if (line.startsWith(\"+\")) {",
    "      rows.push(`${\"+\".padStart(4)}│${sliceVisible(line.slice(1), 72)}`);",
    "    }",
    "    if (rows.length >= 18) {",
    "      rows.push(\"   …│diff preview truncated\");",
    "      break;",
    "    }",
    "  }",
    "  return rows.length === 0 ? [\"   =│no textual changes\"] : rows;",
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


function originalPromptMenu(): string {
  return [
    "function renderPromptMenu(input, inputCursorVisible, width) {",
    "  const cursor = inputCursorVisible === false ? \" \" : \"█\";",
    "  return `${colors.user}›${colors.reset} ${input}${cursor} ${colors.dim}· Enter send · Esc cancel · ↑/↓ scroll${colors.reset}`;",
    "}",
  ].join("\n");
}

function patchedPromptMenu(): string {
  return patchedViewportProgress().split("\n").slice(13, 25).join("\n");
}

function originalReadPromptInitialInput(): string {
  return '    __privateSet(this, _inputText, (_a = options == null ? void 0 : options.initialPrompt) != null ? _a : "");';
}

function patchedReadPromptInitialInput(): string {
  return [
    originalReadPromptInitialInput(),
    "    let harnessPromptHistoryIndex = harnessPromptHistory.length;",
  ].join("\n");
}

function originalReadPromptCharacterInput(): string {
  return [
    "          case \"character\":",
    "            __privateSet(this, _inputText, __privateGet(this, _inputText) + key.value);",
    "            __privateMethod(this, _TerminalRenderer_instances, showInputCursor_fn).call(this);",
    "            __privateMethod(this, _TerminalRenderer_instances, paint_fn).call(this);",
    "            break;",
  ].join("\n");
}

function patchedReadPromptCharacterInput(): string {
  return [
    "          case \"character\":",
    "            __privateSet(this, _inputText, appendHarnessPromptInput(__privateGet(this, _inputText), key.value));",
    "            harnessPromptHistoryIndex = harnessPromptHistory.length;",
    "            __privateMethod(this, _TerminalRenderer_instances, showInputCursor_fn).call(this);",
    "            __privateMethod(this, _TerminalRenderer_instances, paint_fn).call(this);",
    "            break;",
  ].join("\n");
}

function originalReadPromptSubmit(): string {
  return "            const prompt = __privateGet(this, _inputText);";
}

function patchedReadPromptSubmit(): string {
  return [
    "            const prompt = __privateGet(this, _inputText);",
    "            rememberHarnessPrompt(prompt);",
  ].join("\n");
}

function originalReadPromptHistoryNavigation(): string {
  return [
    "          case \"up\":",
    "          case \"down\":",
    "            __privateMethod(this, _TerminalRenderer_instances, handleScroll_fn).call(this, key.type);",
    "            break;",
  ].join("\n");
}

function patchedReadPromptHistoryNavigation(): string {
  return [
    "          case \"up\":",
    "          case \"down\": {",
    "            const nextInput = recallHarnessPrompt(key.type, __privateGet(this, _inputText), harnessPromptHistoryIndex);",
    "            harnessPromptHistoryIndex = nextInput.index;",
    "            __privateSet(this, _inputText, nextInput.text);",
    "            __privateMethod(this, _TerminalRenderer_instances, showInputCursor_fn).call(this);",
    "            __privateMethod(this, _TerminalRenderer_instances, paint_fn).call(this);",
    "            break;",
    "          }",
  ].join("\n");
}

function originalParseKeyDefault(): string {
  return [
    "    default:",
    "      if (value >= \" \" && value !== \"\\x7F\") {",
    "        return { type: \"character\", value };",
    "      }",
    "      return { type: \"ignore\" };",
  ].join("\n");
}

function patchedParseKeyDefault(): string {
  return [
    "    default: {",
    "      const pasted = normalizeHarnessPaste(value);",
    "      if (pasted !== void 0) {",
    "        return { type: \"character\", value: pasted };",
    "      }",
    "      if (value >= \" \" && value !== \"\\x7F\") {",
    "        return { type: \"character\", value };",
    "      }",
    "      return { type: \"ignore\" };",
    "    }",
  ].join("\n");
}

function harnessPromptHelpers(): string {
  return [
    "const harnessPromptHistory = [];",
    "const HARNESS_PROMPT_HISTORY_LIMIT = 100;",
    "function appendHarnessPromptInput(current, value) {",
    "  return `${current}${value}`;",
    "}",
    "function rememberHarnessPrompt(prompt) {",
    "  const trimmed = prompt.trim();",
    "  if (trimmed.length === 0 || harnessPromptHistory[harnessPromptHistory.length - 1] === prompt) {",
    "    return;",
    "  }",
    "  harnessPromptHistory.push(prompt);",
    "  if (harnessPromptHistory.length > HARNESS_PROMPT_HISTORY_LIMIT) {",
    "    harnessPromptHistory.shift();",
    "  }",
    "}",
    "function recallHarnessPrompt(direction, current, index) {",
    "  if (harnessPromptHistory.length === 0) {",
    "    return { text: current, index };",
    "  }",
    "  if (direction === \"up\") {",
    "    const nextIndex = Math.max(0, Math.min(index - 1, harnessPromptHistory.length - 1));",
    "    return { text: harnessPromptHistory[nextIndex] || \"\", index: nextIndex };",
    "  }",
    "  const nextIndex = Math.min(harnessPromptHistory.length, index + 1);",
    "  return { text: nextIndex >= harnessPromptHistory.length ? \"\" : harnessPromptHistory[nextIndex] || \"\", index: nextIndex };",
    "}",
    "function normalizeHarnessPaste(value) {",
    "  if (value.startsWith(\"\\x1B[200~\") && value.endsWith(\"\\x1B[201~\")) {",
    "    return value.slice(6, -6);",
    "  }",
    "  if (value.includes(\"\\x1B[200~\") || value.includes(\"\\x1B[201~\")) {",
    "    return value.replace(/\\x1B\\[200~/g, \"\").replace(/\\x1B\\[201~/g, \"\");",
    "  }",
    "  return value.includes(\"\\n\") || value.includes(\"\\r\") ? value : void 0;",
    "}",
  ].join("\n");
}