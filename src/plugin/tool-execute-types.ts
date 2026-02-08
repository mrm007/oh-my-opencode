export interface ToolExecuteInput {
  tool: string;
  sessionID?: string;
  callID?: string;
}

export interface ToolExecuteOutput {
  args?: unknown;
  title?: string;
  metadata?: Record<string, unknown>;
}
