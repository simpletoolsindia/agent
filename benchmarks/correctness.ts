import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHarness, type ReadOutput, type SearchOutput, type BashOutput, type WriteOutput, type UpdateOutput } from "../src/index.js";
import { JsonConsoleLogger } from "../src/core/logger.js";
import type { ToolResult } from "../src/core/registry.js";
import { createSlashCommandAgent, pickRuntimeSuggestion, withInlineProgress } from "../src/tui/slash-agent.js";
import { reduceProviderSetupInput, renderProviderSetupScreen, resolveProviderSetupOptions } from "../src/tui/provider-setup.js";
import { createCodingInstructions } from "../src/ai/openai-compatible-runtime.js";
import { loadInstructionDocuments } from "../src/ai/context-files.js";
import { renderActivityPulse, renderCliSplash, renderGradientText, renderMetricStrip, renderProgressBar, renderProgressSteps, renderShimmerText, renderStatusBar, stripAnsi, visibleLength } from "../src/tui/status-bar.js";
import { patchAiSdkTuiRenderer } from "../src/tui/ai-sdk-tui-patch.js";
import { createDoctorReport } from "../src/cli/doctor.js";

const workspace = join(process.cwd(), ".correctness-workspace");

type CaseResult = {
  readonly name: string;
  readonly passed: boolean;
  readonly expected: "success" | "failure";
  readonly observed: "success" | "failure";
  readonly code?: string;
};

function observed(result: ToolResult<unknown>): "success" | "failure" {
  return result.ok ? "success" : "failure";
}

function record(name: string, expected: "success" | "failure", result: ToolResult<unknown>): CaseResult {
  const actual = observed(result);
  return {
    name,
    expected,
    observed: actual,
    passed: actual === expected,
    ...(!result.ok ? { code: result.code } : {}),
  };
}

function recordFailureCode(name: string, expectedCode: string, result: ToolResult<unknown>): CaseResult {
  const base = record(name, "failure", result);
  return {
    ...base,
    passed: !result.ok && result.code === expectedCode,
  };
}

function recordCheck(name: string, passed: boolean): CaseResult {
  return {
    name,
    expected: "success",
    observed: passed ? "success" : "failure",
    passed,
  };
}

function mustOutput<O>(result: ToolResult<O>): O {
  if (result.ok) {
    return result.output;
  }

  throw new Error(`${result.code}: ${result.error}`);
}

async function main(): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
  const harness = createHarness(workspace, new JsonConsoleLogger("correctness", "warn"));
  const { registry, context } = harness;
  const results: CaseResult[] = [];

  const createdWrite = await registry.run<WriteOutput>("write", {
    path: "src/example.ts",
    content: "export const value = 1;\n",
  }, context);
  results.push(record("write creates file", "success", createdWrite));
  const createdWriteOutput = mustOutput(createdWrite);
  results.push(recordCheck(
    "write output includes diff, counts, and LSP status",
    createdWriteOutput.change.diff.includes("+++ b/src/example.ts")
      && createdWriteOutput.change.diff.includes("+export const value = 1;")
      && createdWriteOutput.change.addedLines === 1
      && createdWriteOutput.change.removedLines === 0
      && createdWriteOutput.lspValidation.language === "typescript",
  ));

  results.push(record("write rejects overwrite by default", "failure", await registry.run("write", {
    path: "src/example.ts",
    content: "export const value = 2;\n",
  }, context)));

  const read = await registry.run<ReadOutput>("read", {
    path: "src/example.ts",
    startLine: 1,
    limitLines: 1,
  }, context);
  results.push(record("read returns hash guarded slice", "success", read));

  const readOutput = mustOutput(read);
  const updatedWrite = await registry.run<UpdateOutput>("update", {
    path: "src/example.ts",
    fileHash: readOutput.fileHash,
    operations: [{
      kind: "replace",
      startLine: 1,
      endLine: 1,
      expectedHash: readOutput.rangeHash,
      content: "export const value = 3;\n",
    }],
  }, context);
  results.push(record("update accepts matching file and range hash", "success", updatedWrite));
  const updatedWriteOutput = mustOutput(updatedWrite);
  results.push(recordCheck(
    "update output includes counted diff summary",
    updatedWriteOutput.change.diff.includes("-export const value = 1;")
      && updatedWriteOutput.change.diff.includes("+export const value = 3;")
      && updatedWriteOutput.change.addedLines === 1
      && updatedWriteOutput.change.removedLines === 1,
  ));

  const staleRead = mustOutput(await registry.run<ReadOutput>("read", {
    path: "src/example.ts",
    startLine: 1,
    limitLines: 1,
  }, context));

  mustOutput(await registry.run("write", {
    path: "src/example.ts",
    content: "export const value = 4;\n",
    overwrite: true,
  }, context));

  results.push(record("update rejects stale file hash", "failure", await registry.run("update", {
    path: "src/example.ts",
    fileHash: staleRead.fileHash,
    operations: [{
      kind: "replace",
      startLine: 1,
      endLine: 1,
      expectedHash: staleRead.rangeHash,
      content: "export const value = 5;\n",
    }],
  }, context)));

  const mismatchRead = mustOutput(await registry.run<ReadOutput>("read", {
    path: "src/example.ts",
    startLine: 1,
    limitLines: 1,
  }, context));

  results.push(record("update rejects wrong range hash", "failure", await registry.run("update", {
    path: "src/example.ts",
    fileHash: mismatchRead.fileHash,
    operations: [{
      kind: "replace",
      startLine: 1,
      endLine: 1,
      expectedHash: "0".repeat(64),
      content: "export const value = 6;\n",
    }],
  }, context)));

  results.push(recordFailureCode("read rejects invalid line range", "READ_RANGE_INVALID", await registry.run("read", {
    path: "src/example.ts",
    startLine: 99,
    limitLines: 1,
  }, context)));

  results.push(recordFailureCode("update rejects invalid line range", "UPDATE_RANGE_INVALID", await registry.run("update", {
    path: "src/example.ts",
    fileHash: mismatchRead.fileHash,
    operations: [{
      kind: "replace",
      startLine: 99,
      endLine: 100,
      expectedHash: mismatchRead.rangeHash,
      content: "export const value = 7;\n",
    }],
  }, context)));

  results.push(record("search finds exact text", "success", await registry.run<SearchOutput>("search", {
    query: "value = 4",
    path: "src",
    maxMatches: 10,
    literal: true,
  }, context)));

  const bashRun = await registry.run<BashOutput>("bash", {
    command: `${JSON.stringify(process.execPath)} -e "console.log('ok')"`,
  }, context);
  results.push(record("bash runs shell command", "success", bashRun));
  results.push(recordCheck(
    "bash output shows running command and timeout",
    mustOutput(bashRun).command.includes("console.log")
      && mustOutput(bashRun).statusLine.includes("running:")
      && mustOutput(bashRun).timeoutMs === 10000,
  ));

  results.push(recordFailureCode("read missing path is actionable", "PATH_NOT_FOUND", await registry.run("read", {
    path: "batch-tool.ts",
  }, context)));

  results.push(record("bash reports command-not-found exit", "success", await registry.run("bash", {
    command: "definitely-not-a-real-command",
  }, context)));

  results.push(record("schema rejects missing path", "failure", await registry.run("read", {
    startLine: 1,
  }, context)));

  results.push(record("path policy rejects workspace escape", "failure", await registry.run("read", {
    path: "../outside.txt",
  }, context)));

  mustOutput(await registry.run("write", {
    path: "AGENT.md",
    content: "# Agent instructions\nKeep modules cohesive.\n",
  }, context));
  mustOutput(await registry.run("write", {
    path: "SKILLS.md",
    content: "# Skills\nUse focused validation.\n",
  }, context));

  const slashAgent = createSlashCommandAgent({ cwd: workspace, model: "gpt-4o-mini", apiKey: "test" });
  const settingsText = await collectSlashText(slashAgent, "/settings model qwen2.5-coder:7b approval auto");
  results.push(recordCheck("slash settings updates runtime config", settingsText.includes("qwen2.5-coder:7b") && settingsText.includes("| approval | auto |")));

  const autoSettingsText = await collectSlashText(slashAgent, "/settings auto");
  results.push(recordCheck("slash settings has easy auto approval", autoSettingsText.includes("auto mode enabled") && autoSettingsText.includes("| approval | auto |")));

  const contextSettingsText = await collectSlashText(slashAgent, "/settings agent-md AGENT.md skills-md SKILLS.md");
  results.push(recordCheck(
    "slash settings updates markdown context files",
    contextSettingsText.includes("| agent-md | AGENT.md |") && contextSettingsText.includes("| skills-md | SKILLS.md |"),
  ));

  const ollamaSettingsText = await collectSlashText(slashAgent, "/settings ollama");
  results.push(recordCheck(
    "slash settings applies ollama preset",
    ollamaSettingsText.includes("Ollama setup applied")
      && ollamaSettingsText.includes("http://localhost:11434/v1")
      && ollamaSettingsText.includes("| api-key | set |"),
  ));

  const compactText = await collectSlashText(slashAgent, "/compact");
  results.push(recordCheck("slash compact returns local confirmation", compactText.includes("Context compacted")));

  const agentsText = await collectSlashText(slashAgent, "/agents");
  results.push(recordCheck("slash agents documents subagent roles", agentsText.includes("Built-in subagents") && agentsText.includes("research") && agentsText.includes("review") && agentsText.includes("plan")));
  const sessionsText = await collectSlashText(slashAgent, "/sessions");
  results.push(recordCheck("slash sessions lists resumable store", sessionsText.includes("Saved sessions") || sessionsText.includes("No saved sessions")));

  const instructions = createCodingInstructions(workspace);
  results.push(recordCheck(
    "coding instructions include completion and subagent workflow",
    instructions.includes(`Current folder path: ${workspace}`)
      && instructions.includes("Completion contract")
      && instructions.includes("Use subagent immediately")
      && instructions.includes("Do not run git commands")
      && instructions.includes("parallel")
      && instructions.includes("Clean-code target")
  ));

  const contextInstructions = createCodingInstructions(workspace, loadInstructionDocuments(workspace, {
    agentMdPath: "AGENT.md",
    skillsMdPath: "SKILLS.md",
  }));
  results.push(recordCheck(
    "markdown context options load instructions",
    contextInstructions.includes("Additional context from agent.md")
      && contextInstructions.includes("Keep modules cohesive")
      && contextInstructions.includes("Additional context from skills.md")
      && contextInstructions.includes("Use focused validation"),
  ));

  const doctorReport = await createDoctorReport({
    cwd: workspace,
    model: "qwen2.5-coder:7b",
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
    binName: "harness",
    installBinDir: workspace,
    cliPath: process.argv[1],
    envPath: workspace,
  });
  results.push(recordCheck(
    "doctor report explains setup state",
    doctorReport.includes("Harness setup doctor")
      && doctorReport.includes("Workspace:")
      && doctorReport.includes("Model provider")
      && doctorReport.includes("Next start commands")
      && doctorReport.includes("harness tui --setup"),
  ));

  const setupOptions = resolveProviderSetupOptions({ cwd: workspace, model: "gpt-4o-mini", baseURL: undefined, apiKey: "old", approvalMode: undefined, agentMdPath: undefined, skillsMdPath: undefined }, {
    model: "qwen2.5-coder:7b",
    baseURL: " http://localhost:11434/v1 ",
    apiKey: " ollama ",
    approvalMode: "auto",
    agentMdPath: " AGENT.md ",
    skillsMdPath: " SKILLS.md ",
  });
  results.push(recordCheck(
    "provider setup resolves LLM and markdown config",
    setupOptions.model === "qwen2.5-coder:7b"
      && setupOptions.baseURL === "http://localhost:11434/v1"
      && setupOptions.apiKey === "ollama"
      && setupOptions.agentMdPath === "AGENT.md"
      && setupOptions.approvalMode === "auto"
      && setupOptions.skillsMdPath === "SKILLS.md",
  ));

  const setupScreen = renderProviderSetupScreen({
    activeField: 3,
    values: {
      model: "qwen2.5-coder:7b",
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
      approvalMode: "safe",
      agentMdPath: "AGENT.md",
      skillsMdPath: "SKILLS.md",
    },
    message: "Ready",
  }, 88);
  const plainSetupScreen = stripAnsi(setupScreen);
  results.push(recordCheck(
    "provider setup renders modern OMP cockpit",
    plainSetupScreen.includes("Oh My Pi cockpit")
      && plainSetupScreen.includes("Modern five-tool workspace")
      && plainSetupScreen.includes("Profile cards")
      && plainSetupScreen.includes("Workspace context")
      && plainSetupScreen.includes("Command deck")
      && plainSetupScreen.includes("Ctrl+A"),
  ));

  const animatedSetupScreen = renderProviderSetupScreen({
    activeField: 3,
    values: {
      model: "qwen2.5-coder:7b",
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
      approvalMode: "safe",
      agentMdPath: "AGENT.md",
      skillsMdPath: "SKILLS.md",
    },
    frame: 1,
  }, 88);
  results.push(recordCheck(
    "provider setup animates active marker",
    setupScreen !== animatedSetupScreen && animatedSetupScreen.includes("⠙"),
  ));

  const autoApprovalSetup = reduceProviderSetupInput({
    activeField: 3,
    values: {
      model: "gpt-4o-mini",
      baseURL: "",
      apiKey: "",
      approvalMode: "safe",
      agentMdPath: "",
      skillsMdPath: "",
    },
    message: "Ready",
  }, "\u0001");
  results.push(recordCheck(
    "provider setup toggles auto approval",
    autoApprovalSetup.type === "state" && autoApprovalSetup.state.values.approvalMode === "auto",
  ));

  const statusBar = renderStatusBar("Processing", "Waiting for model response or tool stream", 48, "busy");
  results.push(recordCheck(
    "status bar renders bounded processing state",
    statusBar.includes("Processing") && statusBar.includes("█") && statusBar.includes("%") && visibleLength(statusBar) <= 48,
  ));

  const activityPulse = renderActivityPulse("AI running", "Use search before read", 56, 2, "busy");
  const cliSplash = renderCliSplash("qwen2.5-coder:7b", workspace, "auto", 88);
  const plainCliSplash = stripAnsi(cliSplash);
  results.push(recordCheck(
    "rich CLI panels render animated affordances",
    activityPulse.includes("⠹")
      && activityPulse.includes("✦")
      && plainCliSplash.includes("Harness AI · OMP cockpit")
      && plainCliSplash.includes("parallel search/read/bash")
      && plainCliSplash.includes("◆ prompt"),
  ));

  const metricStrip = renderMetricStrip([{ label: "model", value: "qwen", tone: "busy" }, { label: "approval", value: "auto", tone: "success" }], 48);
  const progressSteps = renderProgressSteps(["think", "tools", "answer"], 1, 48);
  const gradientBar = renderProgressBar({ current: 65, total: 100, width: 12, gradient: true });
  const gradientText = renderGradientText("Modern");
  const shimmerText = renderShimmerText("Processing", 2);
  results.push(recordCheck(
    "shared rich primitives render cool-palette progress UI",
    metricStrip.includes("╭─")
      && metricStrip.includes("approval")
      && progressSteps.includes("◆ tools")
      && gradientBar.includes("░")
      && gradientText.includes("\x1B[38;2;")
      && shimmerText.includes("✦")
      && visibleLength(progressSteps) <= 48,
  ));

  await patchAiSdkTuiRenderer();
  const patchedTuiSource = await readFile("node_modules/@ai-sdk/tui/dist/index.js", "utf8");
  results.push(recordCheck(
    "TUI tool and reasoning outputs use referenced box frames",
    patchedTuiSource.includes("rich tui patch v9")
      && patchedTuiSource.includes("renderHarnessOutputBox")
      && patchedTuiSource.includes("harnessSeparator")
      && patchedTuiSource.includes("formatHarnessBashFrame")
      && patchedTuiSource.includes("Timeout:")
      && patchedTuiSource.includes("formatHarnessTodoFrame")
      && patchedTuiSource.includes("formatHarnessSubagentFrame")
      && patchedTuiSource.includes("Live status")
      && patchedTuiSource.includes("formatHarnessReasoningFrame")
      && patchedTuiSource.includes("Think · live")
      && patchedTuiSource.includes("live reasoning stream")
      && (patchedTuiSource.match(/const harnessFrame = formatHarnessToolFrame\(toolName, inputText, part, status\)/g) ?? []).length === 1,
  ));

  const progressParts = await collectInlineProgressText();
  results.push(recordCheck(
    "agent stream adds inline progress and tool suggestions",
    progressParts.includes("Step 1")
      && progressParts.includes("◆ think")
      && progressParts.includes("◆ tools")
      && progressParts.includes("Tip:")
      && progressParts.includes("search running")
      && progressParts.includes("parallel x2: bash running: npm run build")
      && progressParts.includes("Step complete"),
  ));

  results.push(recordCheck(
    "runtime suggestions rotate by seed",
    pickRuntimeSuggestion(0) !== pickRuntimeSuggestion(1),
  ));

  const passed = results.filter((result) => result.passed).length;
  console.log(JSON.stringify({
    successRate: passed / results.length,
    passed,
    total: results.length,
    results,
  }, null, 2));
}

await main();

async function collectSlashText(agent: { readonly stream: (options: { readonly prompt: string }) => PromiseLike<unknown> }, prompt: string): Promise<string> {
  const result = await agent.stream({ prompt }) as { readonly fullStream: AsyncIterable<unknown> };
  let text = "";
  for await (const part of result.fullStream) {
    if (typeof part === "object" && part !== null && "type" in part && part.type === "text-delta" && "text" in part && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text;
}

async function collectInlineProgressText(): Promise<string> {
  async function* source(): AsyncIterable<unknown> {
    yield { type: "start-step" };
    yield { type: "tool-input-start", toolCallId: "call-1", toolName: "search" };
    yield { type: "tool-input-available", toolCallId: "call-1", toolName: "search", input: { query: "needle" } };
    yield { type: "tool-input-start", toolCallId: "call-2", toolName: "bash" };
    yield { type: "tool-input-available", toolCallId: "call-2", toolName: "bash", input: { command: "npm run build" } };
    yield { type: "tool-output-available", toolCallId: "call-1", output: { matches: [] } };
    yield { type: "tool-output-available", toolCallId: "call-2", output: { exitCode: 0 } };
    yield { type: "finish-step" };
  }

  let text = "";
  for await (const part of withInlineProgress(source())) {
    if (typeof part === "object" && part !== null && "type" in part && part.type === "reasoning-delta" && "text" in part && typeof part.text === "string") {
      text += part.text;
    }
  }
  return text;
}
