import * as fs from "fs/promises";
import z from "zod/v4";
import { err, ok, type Result } from "./result.ts";
import type { Conversation } from "./conversation.ts";
import { config } from "./config.ts";
import { goldText } from "./text.ts";
import { rgPath } from "@vscode/ripgrep";

import type { Message } from "./anthropic.ts";

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

agent.tool("list_files", {
  description: "A tool that list all files within a directory",
  schema: z.object({
    dirPath: z.string(),
  }),
  handler: async ({ dirPath }) => {
    try {
      let buffer = "";
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        buffer += `${file}\n`;
      }

      return ok(buffer);
    } catch (e) {
      return err(e as Error);
    }
  },
});

agent.tool("create_file", {
  description: "Create a file with a given extension ",
  schema: z.object({
    filePath: z.string(),

    fileContents: z.string(),
  }),
  handler: async ({ filePath, fileContents }) => {
    try {
      await fs.writeFile(filePath, fileContents, {});

      return ok("Created file successfully");
    } catch (e) {
      return err(e as Error);
    }
  },
});

agent.tool("replace_in_file", {
  description:
    "A tool to replace a `oldStr` with `newStr` in place. It will throw an error if the file does not.",
  schema: z.object({
    filePath: z.string(),
    newStr: z.string(),
    oldStr: z.string(),
  }),
  handler: async ({ filePath, newStr, oldStr }) => {
    try {
      const fileContents = await fs.readFile(filePath, { encoding: "utf8" });

      fileContents.replace(oldStr, newStr);

      await fs.writeFile(filePath, fileContents);

      return ok("Replaced In File successfully");
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
  handler: async ({ owner: _owner, repo: _repo }) => {
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

agent.tool("search_files", {
  description:
    "Search for a string pattern within the files; Returns the path to the files which contain the string pattern",
  schema: z.object({
    searchString: z.string(),
    directory: z.string().optional(),
  }),
  handler: async ({ searchString, directory }) => {
    const proc = Bun.spawn(
      [rgPath, searchString, "--files-with-matches", directory].filter(
        Boolean
      ) as string[]
    );

    const text = await new Response(proc.stdout).text();

    return ok(JSON.stringify(text));
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
