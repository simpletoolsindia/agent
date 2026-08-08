import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createHarness, type ReadOutput, type SearchOutput, type BashOutput } from "../src/index.js";
import { JsonConsoleLogger } from "../src/core/logger.js";
import type { ToolResult } from "../src/core/registry.js";

const workspace = join(process.cwd(), ".bench-workspace");
const fileCount = 80;

function fixture(index: number): string {
  return [
    `export const id${index} = ${index};`,
    `export function value${index}() {`,
    `  return "needle-${index % 8}";`,
    `}`,
    `// benchmark-file-${index}`,
    "",
  ].join("\n");
}

function ensureOk<O>(result: ToolResult<O>): O {
  if (result.ok) {
    return result.output;
  }

  throw new Error(`${result.code}: ${result.error}`);
}

async function measure(label: string, action: () => Promise<number[]>): Promise<{ label: string; totalMs: number; avgMs: number; operations: number }> {
  const started = performance.now();
  const operationTimes = await action();
  const totalMs = performance.now() - started;
  const avgMs = operationTimes.reduce((sum, value) => sum + value, 0) / operationTimes.length;
  return { label, totalMs, avgMs, operations: operationTimes.length };
}

async function main(): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
  const harness = createHarness(workspace, new JsonConsoleLogger("bench", "warn"));
  const { registry, context } = harness;

  const safeWriteStats = await measure("safe write 80 files", async () => {
    const times: number[] = [];
    for (let index = 0; index < fileCount; index += 1) {
      const result = await registry.run("write", {
        path: `safe/file-${index}.ts`,
        content: fixture(index),
        overwrite: true,
        durability: "safe",
      }, context);
      times.push(result.elapsedMs);
      ensureOk(result);
    }
    return times;
  });

  const fastWriteStats = await measure("fast write 80 files", async () => {
    const times: number[] = [];
    for (let index = 0; index < fileCount; index += 1) {
      const result = await registry.run("write", {
        path: `fast/file-${index}.ts`,
        content: fixture(index),
        overwrite: true,
        durability: "fast",
      }, context);
      times.push(result.elapsedMs);
      ensureOk(result);
    }
    return times;
  });

  const readStats = await measure("read 80 slices", async () => {
    const times: number[] = [];
    for (let index = 0; index < fileCount; index += 1) {
      const result = await registry.run<ReadOutput>("read", {
        path: `safe/file-${index}.ts`,
        startLine: 1,
        limitLines: 4,
      }, context);
      times.push(result.elapsedMs);
      ensureOk(result);
    }
    return times;
  });

  const safeUpdateStats = await measure("safe hash-guarded update 20 files", async () => {
    const times: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const line = ensureOk(await registry.run<ReadOutput>("read", {
        path: `safe/file-${index}.ts`,
        startLine: 3,
        limitLines: 1,
      }, context));

      const result = await registry.run("update", {
        path: `safe/file-${index}.ts`,
        fileHash: line.fileHash,
        durability: "safe",
        operations: [{
          kind: "replace",
          startLine: 3,
          endLine: 3,
          expectedHash: line.rangeHash,
          content: `  return "safe-updated-${index}";\n`,
        }],
      }, context);
      times.push(result.elapsedMs);
      ensureOk(result);
    }
    return times;
  });

  const fastUpdateStats = await measure("fast hash-guarded update 20 files", async () => {
    const times: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const line = ensureOk(await registry.run<ReadOutput>("read", {
        path: `fast/file-${index}.ts`,
        startLine: 3,
        limitLines: 1,
      }, context));

      const result = await registry.run("update", {
        path: `fast/file-${index}.ts`,
        fileHash: line.fileHash,
        durability: "fast",
        operations: [{
          kind: "replace",
          startLine: 3,
          endLine: 3,
          expectedHash: line.rangeHash,
          content: `  return "fast-updated-${index}";\n`,
        }],
      }, context);
      times.push(result.elapsedMs);
      ensureOk(result);
    }
    return times;
  });

  const searchResult = await registry.run<SearchOutput>("search", {
    query: "needle-3",
    path: "safe",
    maxMatches: 200,
  }, context);
  const searchOutput = ensureOk(searchResult);

  const bashResult = await registry.run<BashOutput>("bash", {
    command: `${JSON.stringify(process.execPath)} -e "console.log(21 * 2)"`,
    timeoutMs: 5000,
  }, context);
  const bashOutput = ensureOk(bashResult);

  console.log(JSON.stringify({
    benchmark: {
      fileCount,
      workspace,
      safeWrite: safeWriteStats,
      fastWrite: fastWriteStats,
      read: readStats,
      safeUpdate: safeUpdateStats,
      fastUpdate: fastUpdateStats,
      search: {
        label: "ripgrep search needle-3",
        elapsedMs: searchResult.elapsedMs,
        matches: searchOutput.matches.length,
        truncated: searchOutput.truncated,
      },
      bash: {
        label: "node one-shot command",
        elapsedMs: bashResult.elapsedMs,
        exitCode: bashOutput.exitCode,
        stdout: bashOutput.stdout,
      },
    },
  }, null, 2));
}

await main();
