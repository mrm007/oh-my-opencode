import { clearSessionAgent, getMainSessionID, setMainSession, updateSessionAgent } from "../features/claude-code-session-state";
import { log, resetMessageCursor } from "../shared";
import { lspManager } from "../tools";
import type { PluginContext } from "./plugin-types";

export interface PluginEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface EventInput {
  event: PluginEvent;
}

type EventHookLike = { event?: (input: EventInput) => unknown };
type HandlerHookLike = { handler?: (input: EventInput) => unknown };

export interface EventHandlerDeps {
  directory: string;
  client: PluginContext["client"];

  firstMessageVariantGate: {
    markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void;
    clear: (sessionID: string) => void;
  };

  tmuxSessionManager: unknown;

  skillMcpManager: { disconnectSession: (sessionID: string) => Promise<void> };

  sessionRecovery: {
    isRecoverableError: (error: unknown) => boolean;
    handleSessionRecovery: (args: {
      id?: string;
      role: "assistant";
      sessionID?: string;
      error: unknown;
    }) => Promise<boolean>;
  } | null;

  stopContinuationGuard: { isStopped: (sessionID: string) => boolean } | null;

  hooks: {
    autoUpdateChecker: unknown;
    claudeCodeHooks: unknown;
    backgroundNotificationHook: unknown;
    sessionNotification: unknown;
    todoContinuationEnforcer: unknown;
    unstableAgentBabysitter: unknown;
    contextWindowMonitor: unknown;
    directoryAgentsInjector: unknown;
    directoryReadmeInjector: unknown;
    rulesInjector: unknown;
    thinkMode: unknown;
    anthropicContextWindowLimitRecovery: unknown;
    agentUsageReminder: unknown;
    categorySkillReminder: unknown;
    interactiveBashSession: unknown;
    ralphLoop: unknown;
    stopContinuationGuardEventHook: unknown;
    atlasHook: unknown;
  };
}

export function createEventHandler(deps: EventHandlerDeps) {
  return async (input: EventInput) => {
    await (deps.hooks.autoUpdateChecker as EventHookLike | null)?.event?.(input);
    await (deps.hooks.claudeCodeHooks as EventHookLike)?.event?.(input);
    await (deps.hooks.backgroundNotificationHook as EventHookLike | null)?.event?.(
      input,
    );
    await (deps.hooks.sessionNotification as ((i: EventInput) => unknown) | null)?.(
      input,
    );
    await (deps.hooks.todoContinuationEnforcer as HandlerHookLike | null)?.handler?.(
      input,
    );
    await (deps.hooks.unstableAgentBabysitter as EventHookLike | null)?.event?.(
      input,
    );
    await (deps.hooks.contextWindowMonitor as EventHookLike | null)?.event?.(input);
    await (deps.hooks.directoryAgentsInjector as EventHookLike | null)?.event?.(
      input,
    );
    await (deps.hooks.directoryReadmeInjector as EventHookLike | null)?.event?.(
      input,
    );
    await (deps.hooks.rulesInjector as EventHookLike | null)?.event?.(input);
    await (deps.hooks.thinkMode as EventHookLike | null)?.event?.(input);
    await (
      deps.hooks.anthropicContextWindowLimitRecovery as EventHookLike | null
    )?.event?.(input);
    await (deps.hooks.agentUsageReminder as EventHookLike | null)?.event?.(input);
    await (deps.hooks.categorySkillReminder as EventHookLike | null)?.event?.(input);
    await (deps.hooks.interactiveBashSession as EventHookLike | null)?.event?.(
      input,
    );
    await (deps.hooks.ralphLoop as EventHookLike | null)?.event?.(input);
    await (
      deps.hooks.stopContinuationGuardEventHook as EventHookLike | null
    )?.event?.(input);
    await (deps.hooks.atlasHook as HandlerHookLike | null)?.handler?.(input);

    const { event } = input;
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; title?: string; parentID?: string }
        | undefined;
      log("[event] session.created", { sessionInfo, props });
      if (!sessionInfo?.parentID) {
        setMainSession(sessionInfo?.id);
      }
      deps.firstMessageVariantGate.markSessionCreated(sessionInfo);
      await (deps.tmuxSessionManager as unknown as {
        onSessionCreated: (e: unknown) => Promise<void>;
      }).onSessionCreated(
        event as {
          type: string;
          properties?: {
            info?: { id?: string; parentID?: string; title?: string };
          };
        },
      );
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id === getMainSessionID()) {
        setMainSession(undefined);
      }
      if (sessionInfo?.id) {
        clearSessionAgent(sessionInfo.id);
        resetMessageCursor(sessionInfo.id);
        deps.firstMessageVariantGate.clear(sessionInfo.id);
        await deps.skillMcpManager.disconnectSession(sessionInfo.id);
        await lspManager.cleanupTempDirectoryClients();
        await (deps.tmuxSessionManager as unknown as {
          onSessionDeleted: (args: { sessionID: string }) => Promise<void>;
        }).onSessionDeleted({ sessionID: sessionInfo.id });
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined;
      const sessionID = info?.sessionID as string | undefined;
      const agent = info?.agent as string | undefined;
      const role = info?.role as string | undefined;
      if (sessionID && agent && role === "user") {
        updateSessionAgent(sessionID, agent);
      }
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined;
      const error = props?.error;

      if (deps.sessionRecovery?.isRecoverableError(error)) {
        const messageInfo = {
          id: props?.messageID as string | undefined,
          role: "assistant" as const,
          sessionID,
          error,
        };
        const recovered = await deps.sessionRecovery.handleSessionRecovery(messageInfo);

        if (
          recovered &&
          sessionID &&
          sessionID === getMainSessionID() &&
          !deps.stopContinuationGuard?.isStopped(sessionID)
        ) {
          await deps.client.session
            .prompt({
              path: { id: sessionID },
              body: { parts: [{ type: "text" as const, text: "continue" }] },
              query: { directory: deps.directory },
            })
            .catch(() => {});
        }
      }
    }
  };
}
