import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createHarness, type ReadOutput, type SearchOutput, type BashOutput } from "../src/index.js";
import { JsonConsoleLogger } from "../src/core/logger.js";
import type { ToolResult } from "../src/core/registry.js";
import { createSlashCommandAgent, pickRuntimeSuggestion, withInlineProgress } from "../src/tui/slash-agent.js";
import { reduceProviderSetupInput, renderProviderSetupScreen, resolveProviderSetupOptions } from "../src/tui/provider-setup.js";
import { createCodingInstructions } from "../src/ai/openai-compatible-runtime.js";
import { loadInstructionDocuments } from "../src/ai/context-files.js";
import { renderStatusBar, visibleLength } from "../src/tui/status-bar.js";

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

  results.push(record("write creates file", "success", await registry.run("write", {
    path: "src/example.ts",
    content: "export const value = 1;\n",
  }, context)));

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
  results.push(record("update accepts matching file and range hash", "success", await registry.run("update", {
    path: "src/example.ts",
    fileHash: readOutput.fileHash,
    operations: [{
      kind: "replace",
      startLine: 1,
      endLine: 1,
      expectedHash: readOutput.rangeHash,
      content: "export const value = 3;\n",
    }],
  }, context)));

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

  results.push(record("bash runs shell command", "success", await registry.run<BashOutput>("bash", {
    command: `${JSON.stringify(process.execPath)} -e "console.log('ok')"`,
  }, context)));

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

  const instructions = createCodingInstructions(workspace);
  results.push(recordCheck(
    "coding instructions include completion and subagent workflow",
    instructions.includes(`Current folder path: ${workspace}`)
      && instructions.includes("Completion contract")
      && instructions.includes("Use subagent immediately")
      && instructions.includes("Do not run git commands")
      && instructions.includes("Clean-code target"),
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
  results.push(recordCheck(
    "provider setup renders modern rich fields",
    setupScreen.includes("Provider setup")
      && setupScreen.includes("Harness AI cockpit")
      && setupScreen.includes("Connection")
      && setupScreen.includes("Workspace context")
      && setupScreen.includes("Approval mode")
      && setupScreen.includes("Ctrl+A"),
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
    statusBar.includes("Processing") && statusBar.includes("▰") && visibleLength(statusBar) <= 48,
  ));

  const progressParts = await collectInlineProgressText();
  results.push(recordCheck(
    "agent stream adds inline progress and tool suggestions",
    progressParts.includes("Step 1")
      && progressParts.includes("Tip:")
      && progressParts.includes("Tool")
      && progressParts.includes("search running")
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
    yield { type: "tool-output-available", toolCallId: "call-1", output: { matches: [] } };
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
