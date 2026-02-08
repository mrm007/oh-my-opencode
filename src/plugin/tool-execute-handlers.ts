import { createToolExecuteAfterHandler } from "./tool-execute-after-handler";
import type { ToolExecuteAfterDeps } from "./tool-execute-after-handler";
import { createToolExecuteBeforeHandler } from "./tool-execute-before-handler";
import type { ToolExecuteBeforeDeps } from "./tool-execute-before-handler";

export type ToolExecuteHandlersDeps = ToolExecuteBeforeDeps & ToolExecuteAfterDeps;

export function createToolExecuteHandlers(deps: ToolExecuteHandlersDeps) {
  return {
    before: createToolExecuteBeforeHandler(deps),
    after: createToolExecuteAfterHandler(deps),
  };
}
