import readline from "node:readline";
import { agent } from "./agent";
import { Conversation } from "./conversation";
import { goldText } from "./text";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  printWelcomeMessage();

  const conversation = new Conversation([]);

  let isRunning = true;

  while (isRunning) {
    rl.question(`\x1b[35mYou:\x1b[0m Type your task here...\n`, (task) => {
      conversation.addUserContent(task);

      console.clear();

      console.log(`${goldText("Kudamono")}: Your task is - "${task}"\n`);

      agent.run(conversation);
    });

    agent.on("response", (response) => {
      console.log(`${goldText("Kudamono")}:`, response);

      response.content.forEach((contentBlock) => {
        if (contentBlock.type === "text") {
          console.log(`${goldText("Kudamono")}:`, contentBlock.text);
        }
      });

      console.log("");
    });

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
  console.log("Type Ctrl+C to exit!");
  console.log("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
