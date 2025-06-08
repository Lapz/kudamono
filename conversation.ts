type ConversationItem = { role: string; content: string };

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
