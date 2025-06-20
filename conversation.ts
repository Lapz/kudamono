import type { ToolResultMessage, ToolUseMessage } from "./anthropic.ts";

type ConversationItem = {
  role: "user" | "assistant";
  content: string | (ToolResultMessage | ToolUseMessage)[];
};

export class Conversation {
  history: ConversationItem[];

  constructor(history?: ConversationItem[]) {
    this.history = history || [];
  }

  addToHistory(conversationItem: ConversationItem) {
    this.history.push(conversationItem);
  }

  addUserContent(content: string) {
    this.history.push({
      role: "user",
      content,
    });
  }
}
