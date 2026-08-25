import type { CharacterWorkflowClient, CharacterWorkflowSummary } from "./character-workflow-client.mjs";

export interface CharacterWorkflowToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export const toolDefinitions: CharacterWorkflowToolDefinition[];
export function dispatchTool(name: string, args: Record<string, unknown>, client?: CharacterWorkflowClient): Promise<unknown>;
export function resultText(result: CharacterWorkflowSummary): string;
