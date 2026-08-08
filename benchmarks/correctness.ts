import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createHarness, type ReadOutput, type SearchOutput, type BashOutput } from "../src/index.js";
import { JsonConsoleLogger } from "../src/core/logger.js";
import type { ToolResult } from "../src/core/registry.js";

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

  results.push(record("search finds exact text", "success", await registry.run<SearchOutput>("search", {
    query: "value = 4",
    path: "src",
    maxMatches: 10,
  }, context)));

  results.push(record("bash runs argv command", "success", await registry.run<BashOutput>("bash", {
    command: process.execPath,
    args: ["-e", "console.log('ok')"],
  }, context)));

  results.push(record("schema rejects missing path", "failure", await registry.run("read", {
    startLine: 1,
  }, context)));

  results.push(record("path policy rejects workspace escape", "failure", await registry.run("read", {
    path: "../outside.txt",
  }, context)));

  const passed = results.filter((result) => result.passed).length;
  console.log(JSON.stringify({
    successRate: passed / results.length,
    passed,
    total: results.length,
    results,
  }, null, 2));
}

await main();
