import type { MessagesTransformOutput } from "./plugin-types";

export type ExperimentalChatTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: MessagesTransformOutput,
  ) => Promise<void>;
};

export type ExperimentalSessionCompactingHandler = (
  input: { sessionID: string },
  output: { context: string[] },
) => Promise<void>;

export interface ExperimentalHandlers {
  chatMessagesTransform: ExperimentalChatTransformHook;
  sessionCompacting: ExperimentalSessionCompactingHandler;
}

export function createExperimentalHandlers(deps: {
  contextInjectorMessagesTransform: ExperimentalChatTransformHook | null;
  thinkingBlockValidator: ExperimentalChatTransformHook | null;
  compactionContextInjector: (() => string) | null;
}): ExperimentalHandlers {
  const chatMessagesTransform: ExperimentalChatTransformHook = {
    "experimental.chat.messages.transform": async (
      input: Record<string, never>,
      output: MessagesTransformOutput,
    ) => {
      await deps.contextInjectorMessagesTransform?.[
        "experimental.chat.messages.transform"
      ]?.(input, output);
      await deps.thinkingBlockValidator?.["experimental.chat.messages.transform"]?.(
        input,
        output,
      );
    },
  };

  const sessionCompacting: ExperimentalSessionCompactingHandler = async (
    _input,
    output,
  ) => {
    if (!deps.compactionContextInjector) {
      return;
    }
    output.context.push(deps.compactionContextInjector());
  };

  return { chatMessagesTransform, sessionCompacting };
}
