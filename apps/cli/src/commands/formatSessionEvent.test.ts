import type { AgentSessionEvent } from "@code-review-harness/core";
import { describe, expect, it } from "vitest";
import { formatSessionEvent } from "./formatSessionEvent.js";

describe("formatSessionEvent", () => {
  it("trims extra trailing lines from thinking output", () => {
    const output = formatSessionEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Reviewing diff" }],
      },
    } as AgentSessionEvent);

    expect(output).toBe("[35m[1m[thinking][0m\n[2m[35m│[0m [2mReviewing diff[0m\n");
  });
});
