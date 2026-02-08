import { consumeToolMetadata } from "../features/tool-metadata-store";
import type { ToolExecuteInput, ToolExecuteOutput } from "./tool-execute-types";

export interface ToolExecuteAfterDeps {
  claudeCodeHooks: unknown;
  toolOutputTruncator: unknown;
  preemptiveCompaction: unknown;
  contextWindowMonitor: unknown;
  commentChecker: unknown;
  directoryAgentsInjector: unknown;
  directoryReadmeInjector: unknown;
  rulesInjector: unknown;
  emptyTaskResponseDetector: unknown;
  agentUsageReminder: unknown;
  categorySkillReminder: unknown;
  interactiveBashSession: unknown;
  editErrorRecovery: unknown;
  delegateTaskRetry: unknown;
  atlasHook: unknown;
  taskResumeInfo: unknown;
}

export function createToolExecuteAfterHandler(deps: ToolExecuteAfterDeps) {
  return async (input: ToolExecuteInput, output: ToolExecuteOutput | undefined) => {
    if (!output) {
      return;
    }

    const stored = consumeToolMetadata(input.sessionID || "", input.callID || "");
    if (stored) {
      if (stored.title) {
        output.title = stored.title;
      }
      if (stored.metadata) {
        output.metadata = { ...output.metadata, ...stored.metadata };
      }
    }

    type AfterHook = {
      "tool.execute.after"?: (i: ToolExecuteInput, o: ToolExecuteOutput) => unknown;
    };
    const afterHooks: unknown[] = [
      deps.claudeCodeHooks,
      deps.toolOutputTruncator,
      deps.preemptiveCompaction,
      deps.contextWindowMonitor,
      deps.commentChecker,
      deps.directoryAgentsInjector,
      deps.directoryReadmeInjector,
      deps.rulesInjector,
      deps.emptyTaskResponseDetector,
      deps.agentUsageReminder,
      deps.categorySkillReminder,
      deps.interactiveBashSession,
      deps.editErrorRecovery,
      deps.delegateTaskRetry,
      deps.atlasHook,
      deps.taskResumeInfo,
    ];
    for (const hook of afterHooks) {
      await (hook as AfterHook | null)?.["tool.execute.after"]?.(input, output);
    }
  };
}
