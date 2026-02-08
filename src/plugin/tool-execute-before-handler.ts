import { clearBoulderState } from "../features/boulder-state";
import { log } from "../shared";
import type { ToolExecuteInput, ToolExecuteOutput } from "./tool-execute-types";

export interface ToolExecuteBeforeDeps {
  directory: string;
  getMainSessionID: () => string | undefined;

  ralphLoop: unknown;
  stopContinuationGuard: unknown;
  todoContinuationEnforcer: unknown;

  subagentQuestionBlocker: unknown;
  writeExistingFileGuard: unknown;
  questionLabelTruncator: unknown;
  claudeCodeHooks: unknown;
  nonInteractiveEnv: unknown;
  commentChecker: unknown;
  directoryAgentsInjector: unknown;
  directoryReadmeInjector: unknown;
  rulesInjector: unknown;
  tasksTodowriteDisabler: unknown;
  prometheusMdOnly: unknown;
  sisyphusJuniorNotepad: unknown;
  atlasHook: unknown;
}

export function createToolExecuteBeforeHandler(deps: ToolExecuteBeforeDeps) {
  return async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    type BeforeHook = {
      "tool.execute.before"?: (i: ToolExecuteInput, o: ToolExecuteOutput) => unknown;
    };
    const beforeHooks: unknown[] = [
      deps.subagentQuestionBlocker,
      deps.writeExistingFileGuard,
      deps.questionLabelTruncator,
      deps.claudeCodeHooks,
      deps.nonInteractiveEnv,
      deps.commentChecker,
      deps.directoryAgentsInjector,
      deps.directoryReadmeInjector,
      deps.rulesInjector,
      deps.tasksTodowriteDisabler,
      deps.prometheusMdOnly,
      deps.sisyphusJuniorNotepad,
      deps.atlasHook,
    ];
    for (const hook of beforeHooks) {
      await (hook as BeforeHook | null)?.["tool.execute.before"]?.(input, output);
    }

    if (input.tool === "task") {
      const args = output.args as Record<string, unknown>;
      const category = typeof args.category === "string" ? args.category : undefined;
      const subagentType =
        typeof args.subagent_type === "string" ? args.subagent_type : undefined;
      if (category && !subagentType) {
        args.subagent_type = "sisyphus-junior";
      }
    }

    if (deps.ralphLoop && input.tool === "slashcommand") {
      const args = output.args as { command?: string } | undefined;
      const command = args?.command?.replace(/^\//, "").toLowerCase();
      const sessionID = input.sessionID || deps.getMainSessionID() || "";

      const ralph = deps.ralphLoop as unknown as {
        startLoop: (
          sessionID: string,
          prompt: string,
          options: {
            maxIterations?: number;
            completionPromise?: string;
            ultrawork?: boolean;
          },
        ) => void;
        cancelLoop: (sessionID: string) => void;
      };

      if (command === "ralph-loop" && sessionID) {
        const rawArgs = args?.command?.replace(/^\/?(ralph-loop)\s*/i, "") || "";
        const taskMatch = rawArgs.match(/^["'](.+?)["']/);
        const prompt =
          taskMatch?.[1] ||
          rawArgs.split(/\s+--/)[0]?.trim() ||
          "Complete the task as instructed";

        const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
        const promiseMatch = rawArgs.match(
          /--completion-promise=["']?([^"'\s]+)["']?/i,
        );

        ralph.startLoop(sessionID, prompt, {
          maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
          completionPromise: promiseMatch?.[1],
        });
      } else if (command === "cancel-ralph" && sessionID) {
        ralph.cancelLoop(sessionID);
      } else if (command === "ulw-loop" && sessionID) {
        const rawArgs = args?.command?.replace(/^\/?(ulw-loop)\s*/i, "") || "";
        const taskMatch = rawArgs.match(/^["'](.+?)["']/);
        const prompt =
          taskMatch?.[1] ||
          rawArgs.split(/\s+--/)[0]?.trim() ||
          "Complete the task as instructed";

        const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i);
        const promiseMatch = rawArgs.match(
          /--completion-promise=["']?([^"'\s]+)["']?/i,
        );

        ralph.startLoop(sessionID, prompt, {
          ultrawork: true,
          maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
          completionPromise: promiseMatch?.[1],
        });
      }
    }

    if (input.tool === "slashcommand") {
      const args = output.args as { command?: string } | undefined;
      const command = args?.command?.replace(/^\//, "").toLowerCase();
      const sessionID = input.sessionID || deps.getMainSessionID() || "";

      if (command === "stop-continuation" && sessionID) {
        (deps.stopContinuationGuard as unknown as {
          stop?: (sessionID: string) => void;
        })?.stop?.(sessionID);
        (deps.todoContinuationEnforcer as unknown as {
          cancelAllCountdowns?: () => void;
        })?.cancelAllCountdowns?.();
        (deps.ralphLoop as unknown as { cancelLoop?: (sessionID: string) => void })?.cancelLoop?.(
          sessionID,
        );
        clearBoulderState(deps.directory);
        log("[stop-continuation] All continuation mechanisms stopped", {
          sessionID,
        });
      }
    }
  };
}
