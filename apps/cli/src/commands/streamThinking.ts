import type { AgentSessionEvent } from "@code-review-harness/core";
import type { EventScope } from "./formatSessionEvent.js";
import { renderMarkdown } from "./renderMarkdown.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const MAGENTA = "\x1b[35m";

interface StreamState {
  buffer: string;
  active: boolean;
}

/**
 * Buffer thinking deltas per scope, render as markdown at thinking_end.
 * Returns true if event consumed (suppress default formatter for this event).
 */
export function createThinkingStreamer(write: (chunk: string) => void): (event: AgentSessionEvent, scope?: EventScope) => boolean {
  const states = new Map<string, StreamState>();

  function keyOf(scope?: EventScope): string {
    return !scope || scope.kind === "main" ? "main" : `sub:${scope.slot}`;
  }

  function prefixOf(scope?: EventScope): string {
    return !scope || scope.kind === "main" ? "" : `${MAGENTA}${BOLD}[#${scope.slot}]${RESET} `;
  }

  return (event, scope) => {
    if (event.type !== "message_update") return false;
    const sub = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
    if (!sub) return false;
    const key = keyOf(scope);
    const state = states.get(key) ?? { buffer: "", active: false };
    states.set(key, state);

    if (sub.type === "thinking_start") {
      state.buffer = "";
      state.active = true;
      return true;
    }
    if (sub.type === "thinking_delta" && state.active && typeof sub.delta === "string") {
      state.buffer += sub.delta;
      return true;
    }
    if (sub.type === "thinking_end" && state.active) {
      const prefix = prefixOf(scope);
      const rendered = renderMarkdown(state.buffer).trimEnd();
      const bordered = rendered
        .split("\n")
        .map((line) => `${DIM}${MAGENTA}│${RESET} ${DIM}${line}${RESET}`)
        .join("\n");
      write(`${prefix}${MAGENTA}${BOLD}[thinking]${RESET}\n${bordered}\n`);
      state.buffer = "";
      state.active = false;
      return true;
    }
    return false;
  };
}
