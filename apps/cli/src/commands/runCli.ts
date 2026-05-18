import { Command } from "commander";
import { createReviewCommand } from "./createReviewCommand.js";

/** @note Impure — parses process arguments and may start networked review execution. */
export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("crh")
    .description("Code Review Harness")
    .version("0.1.0");
  program.addCommand(createReviewCommand());
  await program.parseAsync(argv);
}
