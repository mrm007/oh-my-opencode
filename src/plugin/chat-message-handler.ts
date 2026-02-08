import type { OhMyOpenCodeConfig } from "../config";
import { setSessionAgent } from "../features/claude-code-session-state";
import { hasConnectedProvidersCache } from "../shared";
import {
  applyAgentVariant,
  resolveAgentVariant,
  resolveVariantForModel,
} from "../shared/agent-variant";

export interface ChatMessageInput {
  sessionID: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  messageID?: string;
  variant?: string;
}


export interface FirstMessageVariantGate {
  shouldOverride: (sessionID: string) => boolean;
  markApplied: (sessionID: string) => void;
}

export interface RalphLoopLike {
  startLoop: (
    sessionID: string,
    prompt: string,
    options: { maxIterations?: number; completionPromise?: string },
  ) => void;
  cancelLoop: (sessionID: string) => void;
}

export interface TuiLike {
  showToast: (args: {
    body: {
      title: string;
      message: string;
      variant: "warning" | "success" | "error" | "info";
      duration?: number;
    };
  }) => Promise<unknown>;
}

export interface ClientLike {
  tui: TuiLike;
}

export interface ChatMessageHandlerDeps {
  client: ClientLike;
  pluginConfig: OhMyOpenCodeConfig;
  firstMessageVariantGate: FirstMessageVariantGate;
  stopContinuationGuard: unknown;
  keywordDetector: unknown;
  claudeCodeHooks: unknown;
  autoSlashCommand: unknown;
  startWork: unknown;
  ralphLoop: RalphLoopLike | null;
}

export function createChatMessageHandler(deps: ChatMessageHandlerDeps) {
  return async (input: ChatMessageInput, output: unknown) => {
    if (input.agent) {
      setSessionAgent(input.sessionID, input.agent);
    }

    const message = (output as { message: { variant?: string } }).message;
    if (deps.firstMessageVariantGate.shouldOverride(input.sessionID)) {
      const variant =
        input.model && input.agent
          ? resolveVariantForModel(deps.pluginConfig, input.agent, input.model)
          : resolveAgentVariant(deps.pluginConfig, input.agent);
      if (variant !== undefined) {
        message.variant = variant;
      }
      deps.firstMessageVariantGate.markApplied(input.sessionID);
    } else {
      if (input.model && input.agent && message.variant === undefined) {
        const variant = resolveVariantForModel(
          deps.pluginConfig,
          input.agent,
          input.model,
        );
        if (variant !== undefined) {
          message.variant = variant;
        }
      } else {
        applyAgentVariant(deps.pluginConfig, input.agent, message);
      }
    }

    await (deps.stopContinuationGuard as unknown as {
      "chat.message"?: (i: ChatMessageInput) => Promise<void>;
    })?.["chat.message"]?.(input);
    await (deps.keywordDetector as unknown as {
      "chat.message"?: (i: ChatMessageInput, o: unknown) => Promise<void>;
    })?.["chat.message"]?.(input, output);
    await (deps.claudeCodeHooks as unknown as {
      "chat.message"?: (i: ChatMessageInput, o: unknown) => Promise<void>;
    })?.["chat.message"]?.(input, output);
    await (deps.autoSlashCommand as unknown as {
      "chat.message"?: (i: ChatMessageInput, o: unknown) => Promise<void>;
    })?.["chat.message"]?.(input, output);
    await (deps.startWork as unknown as {
      "chat.message"?: (i: ChatMessageInput, o: unknown) => Promise<void>;
    })?.["chat.message"]?.(input, output);

    if (!hasConnectedProvidersCache()) {
      deps.client.tui
        .showToast({
          body: {
            title: "⚠️ Provider Cache Missing",
            message:
              "Model filtering disabled. RESTART OpenCode to enable full functionality.",
            variant: "warning",
            duration: 6000,
          },
        })
        .catch(() => {});
    }

    if (deps.ralphLoop) {
      const parts = (output as { parts?: Array<{ type: string; text?: string }> })
        .parts;
      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || "";

      const isRalphLoopTemplate =
        promptText.includes("You are starting a Ralph Loop") &&
        promptText.includes("<user-task>");
      const isCancelRalphTemplate = promptText.includes(
        "Cancel the currently active Ralph Loop",
      );

      if (isRalphLoopTemplate) {
        const taskMatch = promptText.match(
          /<user-task>\s*([\s\S]*?)\s*<\/user-task>/i,
        );
        const rawTask = taskMatch?.[1]?.trim() || "";

        const quotedMatch = rawTask.match(/^["'](.+?)["']/);
        const prompt =
          quotedMatch?.[1] ||
          rawTask.split(/\s+--/)[0]?.trim() ||
          "Complete the task as instructed";

        const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i);
        const promiseMatch = rawTask.match(
          /--completion-promise=["']?([^"'\s]+)["']?/i,
        );

        deps.ralphLoop.startLoop(input.sessionID, prompt, {
          maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
          completionPromise: promiseMatch?.[1],
        });
      } else if (isCancelRalphTemplate) {
        deps.ralphLoop.cancelLoop(input.sessionID);
      }
    }
  };
}
