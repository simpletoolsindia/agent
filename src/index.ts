import { WorkspacePathPolicy } from "./core/path-policy.js";
import { ToolRegistry } from "./core/registry.js";
import type { Logger } from "./core/logger.js";
import { JsonConsoleLogger } from "./core/logger.js";
import { createToolCatalog } from "./tools/catalog.js";

export type Harness = {
  readonly registry: ToolRegistry;
  readonly context: {
    readonly logger: Logger;
    readonly pathPolicy: WorkspacePathPolicy;
  };
};

/** Creates the five-tool harness with one registry and one workspace policy. */
export function createHarness(workspaceRoot: string, logger: Logger = new JsonConsoleLogger()): Harness {
  const registry = new ToolRegistry();
  for (const definition of createToolCatalog()) {
    registry.register(definition.tool);
  }

  return {
    registry,
    context: {
      logger,
      pathPolicy: new WorkspacePathPolicy(workspaceRoot),
    },
  };
}

export type { ReadInput, ReadOutput } from "./tools/read-tool.js";
export type { WriteInput, WriteOutput } from "./tools/write-tool.js";
export type { UpdateInput, UpdateOutput } from "./tools/update-tool.js";
export type { SearchInput, SearchOutput } from "./tools/search-tool.js";
export type { BashInput, BashOutput } from "./tools/bash-tool.js";
export { createToolCatalog } from "./tools/catalog.js";
export type { HarnessToolDefinition, HarnessToolMetadata, ToolSafety } from "./tools/catalog.js";
