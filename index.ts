import readline from "node:readline/promises";
import { agent } from "./agent";
import { Conversation } from "./conversation";
import { goldText, grayText } from "./text";
import { err, isError, isOk, ok, type Result } from "./result";
import type { Message, ToolUseContent } from "./anthropic";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  printWelcomeMessage();

  const conversation = new Conversation([]);

  let isRunning = true;

  while (isRunning) {
    const task = await rl.question(
      `\x1b[35mYou:\x1b[0m Type your task here...\n`
    );

    const didRunCliCommand = maybeRunCommand(task);

    if (isOk(didRunCliCommand)) {
      continue;
    }

    conversation.addUserContent(task);

    console.log(`${goldText("Kudamono")}: Your task is - "${task}"\n`);

    const response = await agent.run(conversation);

    console.log(`${goldText("Kudamono")}:`, response);

    if (isError(response)) {
      console.log(
        `${goldText(
          "Kudamono"
        )}: Sorry I couldn't process your request because:`,
        response.error
      );
      continue;
    }

    await handleAgentMessage(conversation, response.data);

    console.log("");

    rl.on("close", () => {
      isRunning = false;
    });
  }
}

function printWelcomeMessage() {
  console.log("\n\t\tWelcome to the kudamono CLI !\n\n");
  console.log("Type a command and press enter to submit it.");
  console.log("Type 'exit' to quit the program");
  console.log("Type 'help' to see a list of available commands");
  console.log("Type 'tools' to see the registered tools");
  console.log("Type 'clear' to clear the terminal");
  console.log("Press Ctrl+C to exit!");
  console.log("\n");
}

function handleToolUse(
  message: ToolUseContent
): Promise<Result<string, unknown>> {
  console.log(`${goldText("Kudamono")}: Using tool "${message.name}"\n`);

  const maybeTool = agent.getTool(message.name);

  if (isError(maybeTool)) {
    return Promise.resolve(
      err(new Error(`Unknown tool_used by claude ${message.name}`))
    );
  }

  const tool = maybeTool.data;

  return tool.process(message.input);
}

function maybeRunCommand(userInput: string): Result<undefined, undefined> {
  const trimmedInput = userInput.trim();

  switch (trimmedInput) {
    case "exit":
      process.exit(0);

    case "help":
      printWelcomeMessage();
      return ok(undefined);
    case "clear":
      console.clear();
      return ok(undefined);
    case "tools": {
      console.clear();
      let buffer = `${goldText(
        "Kudamono"
      )}: Here are all the available tools:\n\n`;

      let longestToolName = 0;

      agent.tools.forEach((toolConfig, tool) => {
        longestToolName = Math.max(tool.length, longestToolName);
      });

      agent.tools.forEach((toolConfig, tool) => {
        buffer += `${grayText(tool.padEnd(longestToolName, " "))}\t${
          toolConfig.description ? "- " + toolConfig.description : ""
        }\n`;
      });

      buffer += "\n";

      console.table(buffer);
      return ok(undefined);
    }
  }

  return err(undefined);
}

async function handleAgentMessage(
  conversation: Conversation,
  message: Message
) {
  for (let index = 0; index < message.content.length; index++) {
    const contentBlock = message.content[index];

    if (!contentBlock) {
      continue;
    }

    switch (contentBlock.type) {
      case "text":
        console.log(`${goldText("Kudamono")}:`, contentBlock.text);
        break;
      case "tool_use": {
        const toolResult = await handleToolUse(contentBlock);

        if (isOk(toolResult)) {
          conversation.addToHistory({
            role: "assistant",
            content: [contentBlock],
          });
          conversation.addToHistory({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: contentBlock.id,
                content: toolResult.data,
                is_error: false,
              },
            ],
          });
        } else {
          conversation.addToHistory({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: contentBlock.id,
                content: (toolResult.error as Error).stack ?? "",
                is_error: true,
              },
            ],
          });
        }

        const response = await agent.run(conversation);

        if (isError(response)) {
          console.log(
            `${goldText(
              "Kudamono"
            )}: Sorry I couldn't process your request because:`,
            response.error
          );
          continue;
        }

        await handleAgentMessage(conversation, response.data);

        break;
      }

      default:
        break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
