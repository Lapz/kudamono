import fs from "fs/promises";
import z, { type ZodTypeAny } from "zod";
import { err, ok, type Result } from "./result";
import type { Conversation } from "./conversation";
import { config } from "./config";
import { goldText } from "./text";
import EventEmitter from "events";
import type { Emitter, EventKey, EventReceiver } from "./events";
import type { Message } from "./Anthropic";

type Tool<K = unknown> = {
  name: string;
  description?: string;
  schema: K;
  process(
    args: Zod.infer<K extends ZodTypeAny ? K : never>
  ): Promise<Result<unknown, unknown>>;
};

type EventMap = Record<string, any>;

interface Agentic<T extends EventMap> extends Emitter<T> {
  tools: Map<string, Tool<unknown>>;
  emitter: EventEmitter;
  tool<K extends Zod.ZodTypeAny>(
    name: string,
    {
      description,
      schema,
      handler,
    }: {
      description?: string;
      schema: K;
      handler: (args: z.infer<K>) => Promise<Result<unknown, unknown>>;
    }
  ): void;

  initialize(): string;

  run(conversation: Conversation): Promise<Result<Message, Error>>;
}

type Events = {
  response: object;
};

export const agent: Agentic<Events> = {
  tools: new Map<string, Tool>(),
  emitter: new EventEmitter(),
  tool(name, { description, schema, handler }) {
    const tool: Tool = {
      name,
      description,
      schema,
      process: async (args) => {
        const parsedArgs = schema.parse(args);
        return handler(parsedArgs);
      },
    };
    this.tools.set(name, tool);
  },

  initialize() {
    const prompt = buildPrompt(this.tools);

    return prompt;
  },

  async run(conversation) {
    console.log(`${goldText("Kudamono")} is thinking...\n`);

    const requestBody = {
      model: config.model,
      max_tokens: 1024,
      messages: conversation.history,
      system: agent.initialize(),
    };
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(await response.clone().text());

      return err(new Error(await response.clone().text()));
    }
    /// todo try catch this
    const body = await response.json();

    this.emitter.emit("response", body);

    return ok(body as Message);
  },

  on<K extends EventKey<Events>>(eventName: K, fn: EventReceiver<Events[K]>) {
    this.emitter.on(eventName, fn);
  },

  off<K extends EventKey<Events>>(eventName: K, fn: EventReceiver<Events[K]>) {
    this.emitter.off(eventName, fn);
  },

  emit<K extends EventKey<Events>>(eventName: K, params: Events[K]) {
    this.emitter.emit(eventName, params);
  },
};

agent.tool("fetch_file", {
  description: "Fetch a file from the filesystem",
  schema: z.string(),
  handler: async (filePath) => {
    try {
      const file = await fs.readFile(filePath, "utf-8");
      return ok(file);
    } catch (e) {
      return err(e);
    }
  },
});

agent.tool("github", {
  description: "A tool to interact with GitHub",
  schema: z.object({
    owner: z.string(),
    repo: z.string(),
  }),
  handler: async ({ owner, repo }) => {
    return {
      success: true,
      data: { owner: "lapz", repo: "mori" },
    };
  },
});

agent.tool("add_numbers", {
  description: "Add two numbers",
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  handler: async ({ a, b }) => {
    return ok(a + b);
  },
});

function buildPrompt(tools: Map<string, Tool<unknown>>) {
  const initialPrompt = `You are a helpful assistant. You can use the following tools:
  ${Array.from(tools.values())
    .map((tool) => {
      return `- ${tool.name}: ${tool.description}`;
    })
    .join("\n")}
  You can use these tools to help answer questions. If you need to use a tool, please respond with the tool name and the arguments in JSON format. For example:
  {
    "tool_name": "add_numbers",
    "args": {
      "a": 1,
      "b": 2
    }
  }
  If you don't need to use a tool, just respond with your answer.`;
  return initialPrompt;
}
