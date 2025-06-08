import fs from "fs/promises";
import z from "zod/v4";
import { err, ok, type Result } from "./result";
import type { Conversation } from "./conversation";
import { config } from "./config";
import { goldText } from "./text";

import type { Message } from "./anthropic";

type Tool = {
  name: string;
  description?: string;
  schema: z.ZodType;
  process(args: unknown): Promise<Result<string, Error>>;
};

interface Agentic {
  tools: Map<string, Tool>;
  tool<K extends z.ZodType>(
    name: string,
    {
      description,
      schema,
      handler,
    }: {
      description?: string;
      schema: K;
      handler: (args: z.infer<K>) => Promise<Result<string, Error>>;
    }
  ): void;

  initialize(): string;

  run(conversation: Conversation): Promise<Result<Message, Error>>;
  getTool(name: string): Result<Tool, undefined>;
}

type Events = {
  response: object;
};

export const agent: Agentic = {
  tools: new Map<string, Tool>(),

  tool(name, { description, schema, handler }) {
    const tool: Tool = {
      name,
      description,
      schema,
      process: async (args) => {
        const parsedArgs = schema.safeParse(args);

        if (!parsedArgs.success) {
          return err(
            new Error(
              `Wrong args for tool (${name}) used by Kudamono\n:${args}`
            )
          );
        }

        return handler(parsedArgs.data);
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
      tools: this.tools
        .entries()
        .map(([toolName, toolConfig]) => {
          return {
            name: toolName,
            description: toolConfig.description,
            input_schema: z.toJSONSchema(toolConfig.schema),
          };
        })
        .toArray(),
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

    return ok(body as Message);
  },

  getTool(name) {
    const tool = this.tools.get(name);

    if (!tool) {
      return err(undefined);
    }

    return ok(tool);
  },
};

agent.tool("fetch_file", {
  description: "Fetch a file from the filesystem",
  schema: z.object({
    filePath: z.string(),
  }),
  handler: async ({ filePath }) => {
    try {
      const file = await fs.readFile(filePath, "utf-8");
      return ok(file);
    } catch (e) {
      return err(e as Error);
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
    return ok(
      JSON.stringify({
        success: true,
        data: { owner: "lapz", repo: "mori" },
      })
    );
  },
});

agent.tool("add_numbers", {
  description: "Add two numbers",
  schema: z.object({
    a: z.number(),
    b: z.number(),
  }),
  handler: async ({ a, b }) => {
    return ok(JSON.stringify(a + b));
  },
});

function buildPrompt(tools: Map<string, Tool>) {
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
