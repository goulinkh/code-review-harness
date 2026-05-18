import type { AgentSessionEvent } from "@code-review-harness/core";
import type { EventScope } from "./formatSessionEvent.js";
import { renderMarkdown } from "./renderMarkdown.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const MAGENTA = "\x1b[35m";
const CLEAR_PREV_LINE = "\x1b[1A\x1b[2K";

interface StreamState {
  buffer: string;
  pending: string;
  active: boolean;
  headerEmitted: boolean;
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
    const state = states.get(key) ?? { buffer: "", pending: "", active: false, headerEmitted: false };
    states.set(key, state);
    const prefix = prefixOf(scope);

    if (sub.type === "thinking_start") {
      state.buffer = "";
      state.pending = "";
      state.active = true;
      state.headerEmitted = false;
      return true;
    }
    if (sub.type === "thinking_delta" && state.active && typeof sub.delta === "string") {
      state.buffer += sub.delta;
      state.pending += sub.delta;
      let newlineIndex = state.pending.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = state.pending.slice(0, newlineIndex);
        state.pending = state.pending.slice(newlineIndex + 1);
        if (!state.headerEmitted) {
          write(`${CLEAR_PREV_LINE}${prefix}${MAGENTA}${BOLD}[thinking]${RESET}\n`);
          state.headerEmitted = true;
        }
        if (line.trim()) write(`${DIM}${MAGENTA}│${RESET} ${line}\n`);
        newlineIndex = state.pending.indexOf("\n");
      }
      return true;
    }
    if (sub.type === "thinking_end" && state.active) {
      if (state.pending.trim()) {
        if (!state.headerEmitted) {
          write(`${CLEAR_PREV_LINE}${prefix}${MAGENTA}${BOLD}[thinking]${RESET}\n`);
          state.headerEmitted = true;
        }
        write(`${DIM}${MAGENTA}│${RESET} ${state.pending}\n`);
      }
      if (state.headerEmitted) write("\n");
      state.buffer = "";
      state.pending = "";
      state.active = false;
      state.headerEmitted = false;
      return true;
    }
    return false;
  };
}
