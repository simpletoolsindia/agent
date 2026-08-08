import type { ContentPart } from "ai";
import type { ApprovalMode } from "./ai-tools.js";
import {
  createOpenAICompatibleCodingAgent,
  type OpenAICompatibleCodingAgentOptions,
} from "./coding-agent.js";

export type OpenAICompatibleAiOptions = OpenAICompatibleCodingAgentOptions & {
  readonly prompt: string;
};

export type OpenAICompatibleAiResult = {
  readonly text: string;
};

export async function runOpenAICompatibleAi(options: OpenAICompatibleAiOptions): Promise<OpenAICompatibleAiResult> {
  const { agent, approvalMode } = createOpenAICompatibleCodingAgent({
    ...options,
    loggerScope: "ai",
    loggerLevel: "info",
  });

  const result = await agent.generate({ prompt: options.prompt });
  const approvalNotice = formatApprovalNotice(result.content, approvalMode);
  const text = [result.text, approvalNotice].filter((part) => part.length > 0).join("\n\n");

  return { text };
}

function formatApprovalNotice(content: readonly ContentPart<Record<string, never>>[], approvalMode: ApprovalMode): string {
  if (approvalMode === "auto" || !hasManualApprovalRequest(content)) {
    return "";
  }

  return [
    "Approval required before the agent can continue.",
    "Use the interactive TUI to approve the tool call, or rerun this trusted task with --auto-approve.",
  ].join("\n");
}

function hasManualApprovalRequest(content: readonly unknown[]): boolean {
  return content.some((part) => {
    if (typeof part !== "object" || part === null) {
      return false;
    }

    const record = part as Record<string, unknown>;
    return record.type === "tool-approval-request" && record.isAutomatic !== true;
  });
}
