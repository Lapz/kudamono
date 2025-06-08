export type Message = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<ToolUseContent | TextContent>;
  /**
     * This may be one the following values:
    "end_turn": the model reached a natural stopping point
    "max_tokens": we exceeded the requested max_tokens or the model's maximum
    "stop_sequence": one of your provided custom stop_sequences was generated
    "tool_use": the model invoked one or more tools
    "pause_turn": we paused a long-running turn. You may provide the response back as-is in a subsequent request to let the model continue.
     */
  stop_reason:
    | null
    | "end_turn"
    | "max_tokens"
    | "stop_sequence"
    | "tool_use"
    | "pause_turn";

  stop_sequence: null | string;
};

export type ToolUseContent = {
  id: string;
  input: Record<string, unknown>;
  name: string;
  type: "tool_use";
};

export type TextContent = {
  type: "text";
  text: string;
};

export type ToolResultMessage = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error: boolean;
};

export type ToolUseMessage = ToolUseContent;
