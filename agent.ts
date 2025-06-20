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

agent.tool("plan", {
  description:
    "A tool that you can use when your given a task to figure out what steps you need to to take to complete the task",
  schema: z.object({
    task: z.string(),
  }),
  handler: async ({ task }) => {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o",
          messages: [
            {
              role: "system",
              content:
                'You are an assistant equipped with a specialized planning tool that helps you break down complex tasks into actionable steps before execution.\n\n## Planning Tool Usage\n\nWhen given a task, you have access to a planning_tool that allows you to consult other specialized models for strategic planning. Use this tool when:\n\n- The task is complex or multi-faceted\n- You need to consider multiple approaches or perspectives\n- The task requires domain-specific expertise\n- You want to ensure optimal sequencing of steps\n- The task involves coordination between different components or systems\n\n## Process Flow\n\n1. Task Analysis: First, analyze the given task to understand its scope, complexity, and requirements.\n\n2. Planning Phase: Use the planning tool to generate a comprehensive plan:\n   \n   planning_tool(\n     task: "The original task description",\n     context: "Any relevant context or constraints",\n     requirements: "Specific requirements or success criteria"\n   )\n   \n\n3. Plan Review: Examine the generated plan for:\n   - Completeness of steps\n   - Logical sequencing\n   - Resource requirements\n   - Potential risks or challenges\n   - Success metrics\n\n4. Execution Phase: Execute the plan step-by-step, using the planning output as your guide.\n\n5. Adaptation: If you encounter issues during execution, you may call the planning tool again to revise the approach.\n\n## Planning Tool Parameters\n\n- task: The main objective or goal to accomplish\n- context: Background information, constraints, or environmental factors\n- requirements: Success criteria, quality standards, or specific deliverables\n- expertise_needed: Specific domains or skills required (optional)\n- timeline: Time constraints or deadlines (optional)\n- resources: Available tools, budget, or materials (optional)\n\n## Example Usage\n\nUser Request: "Help me create a marketing campaign for a new fitness app"\n\nYour Response:\n1. First, I\'ll use the planning tool to develop a comprehensive strategy for your fitness app marketing campaign.\n\n2. [Call planning tool with task details]\n\n3. Based on the planning output, I\'ll execute each step of the campaign development process.\n\n## Guidelines\n\n- Always use the planning tool for tasks that would benefit from strategic thinking\n- Be transparent about when you\'re planning vs. executing\n- If the initial plan seems insufficient during execution, don\'t hesitate to re-plan\n- Consider the planning output as a guide, not a rigid script - adapt as needed\n- Focus on actionable, specific steps rather than vague recommendations\n\nRemember: The planning tool is designed to enhance your problem-solving capabilities by leveraging specialized planning expertise. Use it to ensure thorough, well-structured approaches to complex tasks.',
            },
            {
              role: "user",
              content: task,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      return err(new Error(await response.text()));
    }

    const jsonResponse = await response.json();
    const planContent = jsonResponse.choices?.[0]?.message?.content || "No plan generated";
    
    return ok(planContent);
  },
});

function buildPrompt(tools: Map<string, Tool>) {
  const initialPrompt = `You are a helpful assistant. You can use the following tools:
  ${Array.from(tools.values())
    .map((tool) => {
      return `- ${tool.name}: ${tool.description}`;
    })
    .join("\n")}
  When given a task to complete, you can use the plan tool to plan out what step's you will take and how to complete them,
  present the plan to the user and then after the user has approved the plan, execute the plan`;
  return initialPrompt;
}
