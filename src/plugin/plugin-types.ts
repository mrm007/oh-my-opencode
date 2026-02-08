import type { Plugin } from "@opencode-ai/plugin";
import type { Message, Part } from "@opencode-ai/sdk";

export type PluginContext = Parameters<Plugin>[0];

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

export interface MessagesTransformOutput {
  messages: MessageWithParts[];
}
