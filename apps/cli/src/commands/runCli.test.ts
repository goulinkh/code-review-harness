import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

const createReviewCommand = vi.hoisted(() => vi.fn(() => new Command("review")));

vi.mock("./createReviewCommand.js", () => ({ createReviewCommand }));

import { runCli } from "./runCli.js";

describe("runCli", () => {
  it("configures CLI and parses argv", async () => {
    await runCli(["node", "crh", "review"]);
    expect(createReviewCommand).toHaveBeenCalled();
  });
});
