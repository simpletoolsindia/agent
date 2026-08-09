import { jsonSchema, tool, type Tool as AiSdkTool } from "ai";
import type { ToolContext } from "../core/tool.js";
import type { ToolRegistry } from "../core/registry.js";
import { createToolCatalog, type HarnessToolDefinition } from "../tools/catalog.js";
import { createSubagentTool, type SubagentToolOptions } from "./subagent-tool.js";

export type ApprovalMode = "safe" | "auto";

export type AiToolBundle = {
  readonly tools: Record<string, AiSdkTool>;
  readonly approvals: Record<string, "not-applicable" | "user-approval">;
};
export type AiToolBundleOptions = {
  readonly subagent?: SubagentToolOptions;
};


export function createAiToolBundle(registry: ToolRegistry, context: ToolContext, approvalMode: ApprovalMode, options: AiToolBundleOptions = {}): AiToolBundle {
  const tools: Record<string, AiSdkTool> = {};
  const approvals: Record<string, "not-applicable" | "user-approval"> = {};

  for (const definition of createToolCatalog()) {
    tools[definition.tool.name] = toAiTool(definition, registry, context, approvalMode);
    approvals[definition.tool.name] = approvalMode === "auto" || definition.metadata.safety === "read-only"
      ? "not-applicable"
      : "user-approval";
  }

  if (options.subagent !== undefined) {
    tools.subagent = createSubagentTool(registry, context, options.subagent);
    approvals.subagent = "not-applicable";
  }

  return { tools, approvals };
}

function toAiTool(
  definition: HarnessToolDefinition,
  registry: ToolRegistry,
  context: ToolContext,
  approvalMode: ApprovalMode,
): AiSdkTool {
  return tool({
    title: toolTitle(definition, approvalMode),
    metadata: { safety: definition.metadata.safety },
    description: `${definition.metadata.title}. ${definition.metadata.description}`,
    inputSchema: jsonSchema(definition.tool.schema as never),
    strict: true,
    execute: async (input: unknown) => registry.run(definition.tool.name, input, context),
  });
}

function toolTitle(definition: HarnessToolDefinition, approvalMode: ApprovalMode): string {
  if (definition.metadata.safety === "read-only") {
    return definition.metadata.title;
  }

  const prefix = approvalMode === "auto" ? "Auto-approved" : "Approval required";
  return `${prefix} · ${definition.metadata.title}`;
}
