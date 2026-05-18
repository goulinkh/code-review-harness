import type { AgentSessionEvent } from "@code-review-harness/core";
import { describe, expect, it } from "vitest";
import { formatSessionEvent } from "./formatSessionEvent.js";
import { createThinkingStreamer } from "./streamThinking.js";

describe("formatSessionEvent", () => {
  it("renders assistant text on message_end (thinking handled by streamer)", () => {
    const output = formatSessionEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Reviewing diff" },
          { type: "text", text: "Looks good" },
        ],
      },
    } as AgentSessionEvent);

    expect(output).toContain("[agent]");
    expect(output).toContain("Looks good");
    expect(output).not.toContain("Reviewing diff");
  });

  it("returns undefined when message has only thinking", () => {
    const output = formatSessionEvent({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "Reviewing diff" }],
      },
    } as AgentSessionEvent);
    expect(output).toBeUndefined();
  });
});

describe("createThinkingStreamer", () => {
  it("streams thinking deltas inline with border", () => {
    const chunks: string[] = [];
    const stream = createThinkingStreamer((c) => chunks.push(c));
    expect(stream({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: {} } } as unknown as AgentSessionEvent)).toBe(true);
    expect(stream({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Hello", partial: {} } } as unknown as AgentSessionEvent)).toBe(true);
    expect(stream({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "\nWorld", partial: {} } } as unknown as AgentSessionEvent)).toBe(true);
    expect(stream({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "Hello\nWorld", partial: {} } } as unknown as AgentSessionEvent)).toBe(true);
    const out = chunks.join("");
    expect(out).toContain("[thinking]");
    expect(out).toContain("Hello");
    expect(out).toContain("World");
  });

  it("returns false for non-thinking events", () => {
    const stream = createThinkingStreamer(() => undefined);
    expect(stream({ type: "turn_end" } as unknown as AgentSessionEvent)).toBe(false);
    expect(stream({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x", partial: {} } } as unknown as AgentSessionEvent)).toBe(false);
  });
});
