import type { AgentSessionEvent } from "@code-review-harness/core";
import { renderMarkdown } from "./renderMarkdown.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const MAGENTA = "\x1b[35m";

function tag(color: string, label: string): string {
  return `${color}${BOLD}[${label}]${RESET}`;
}

export type EventScope =
  | { kind: "main" }
  | { kind: "sub"; slot: number; scope: string };

function scopePrefix(scope?: EventScope): string {
  if (!scope || scope.kind === "main") return "";
  return `${MAGENTA}${BOLD}[#${scope.slot}]${RESET} `;
}

function truncateScope(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function subBanner(slot: number, scope: string, closing = false): string {
  const label = closing ? `/sub-agent #${slot}` : `sub-agent #${slot} ─ ${truncateScope(scope)}`;
  return `${MAGENTA}${BOLD}── ${label} ──${RESET}`;
}

function countFindings(result: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  const findings = r["findings"] ?? (r["details"] as Record<string, unknown> | undefined)?.["findings"];
  return Array.isArray(findings) ? findings.length : undefined;
}

function truncate(value: unknown, maxLen = 120): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

const toolStartTimes = new Map<string, number>();

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function createDurationKey(event: { toolCallId?: string; toolName?: string }, scope?: EventScope): string {
  const slot = scope?.kind === "sub" ? scope.slot : "main";
  return `${slot}:${event.toolCallId ?? event.toolName ?? "?"}`;
}

interface AssistantBlocks {
  thinking: string[];
  text: string[];
}

function extractAssistantBlocks(message: unknown): AssistantBlocks | undefined {
  if (!message || typeof message !== "object") return undefined;
  const msg = message as Record<string, unknown>;
  if (msg["role"] !== "assistant") return undefined;
  if (!Array.isArray(msg["content"])) return undefined;
  const thinking: string[] = [];
  const text: string[] = [];
  for (const block of msg["content"] as unknown[]) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b["type"] === "thinking" && typeof b["thinking"] === "string" && b["thinking"].trim()) {
      thinking.push(b["thinking"].trim());
    } else if (b["type"] === "text" && typeof b["text"] === "string" && b["text"].trim()) {
      text.push(b["text"].trim());
    }
  }
  if (thinking.length === 0 && text.length === 0) return undefined;
  return { thinking, text };
}

/**
 * Format an AgentSessionEvent into a human-readable line for stderr output.
 * Returns undefined for noisy events that don't need user-visible output.
 */
export function formatSessionEvent(event: AgentSessionEvent, scope?: EventScope): string | undefined {
  const p = scopePrefix(scope);
  switch (event.type) {
    case "agent_start":
      if (scope?.kind === "sub") return subBanner(scope.slot, scope.scope);
      return `${tag(GREEN, "agent")} Starting review session`;

    case "agent_end": {
      const last = event.messages.at(-1) as unknown as Record<string, unknown> | undefined;
      if (last?.["role"] === "assistant" && last?.["stopReason"] === "error") {
        const err = typeof last["errorMessage"] === "string" ? last["errorMessage"] : "unknown model error";
        return `${p}${tag(RED, "error")} Session ended with error: ${err}`;
      }
      if (scope?.kind === "sub") return subBanner(scope.slot, scope.scope, true);
      return `${tag(GREEN, "agent")} Session complete`;
    }

    case "turn_start":
      return undefined;

    case "turn_end":
      return undefined;

    case "message_start": {
      const role = (event as { message?: { role?: string } }).message?.role;
      if (role !== "assistant") return undefined;
      const label = scope?.kind === "sub" ? "sub-agent" : "agent";
      return `${p}${tag(DIM, label)} responding…`;
    }

    case "message_update":
      return undefined;

    case "message_end": {
      const msg = event.message as unknown as Record<string, unknown>;
      if (msg["role"] === "assistant" && msg["stopReason"] === "error") {
        const err = typeof msg["errorMessage"] === "string" ? msg["errorMessage"] : "unknown model error";
        return `${p}${tag(RED, "error")} Model error: ${err}`;
      }
      const blocks = extractAssistantBlocks(event.message);
      if (!blocks || blocks.text.length === 0) return undefined;
      const agentLabel = scope?.kind === "sub" ? "sub-agent" : "agent";
      return `${p}${tag(CYAN, agentLabel)}\n${renderMarkdown(blocks.text.join("\n\n"))}\n`;
    }

    case "tool_execution_start": {
      const args = truncate(event.args);
      toolStartTimes.set(createDurationKey(event, scope), Date.now());
      return `${p}${tag(YELLOW, "tool")} ${BOLD}${event.toolName}${RESET} ${DIM}${args}${RESET}`;
    }

    case "tool_execution_update":
      return undefined;

    case "tool_execution_end": {
      const key = createDurationKey(event, scope);
      const startedAt = toolStartTimes.get(key);
      toolStartTimes.delete(key);
      const dur = startedAt !== undefined ? ` ${DIM}(${formatDuration(Date.now() - startedAt)})${RESET}` : "";
      if (event.isError) {
        return `${p}${tag(RED, "tool")} ${event.toolName} failed${dur}: ${truncate(event.result)}`;
      }
      if (event.toolName === "delegate_review" && (!scope || scope.kind === "main")) {
        const count = countFindings(event.result);
        const tail = count !== undefined ? `${count} finding${count === 1 ? "" : "s"}` : "done";
        return `${tag(GREEN, "agent")} delegate_review complete (${tail})${dur}`;
      }
      if (startedAt !== undefined) {
        return `${p}${tag(GREEN, "tool")} ${BOLD}${event.toolName}${RESET}${dur}`;
      }
      return undefined;
    }

    case "compaction_start":
      return `${p}${tag(DIM, "compact")} Compacting context (${event.reason})...`;

    case "compaction_end":
      if (event.aborted) return `${p}${tag(DIM, "compact")} Compaction aborted`;
      return `${p}${tag(DIM, "compact")} Compaction complete`;

    case "auto_retry_start":
      return `${p}${tag(YELLOW, "retry")} Retrying (attempt ${event.attempt}/${event.maxAttempts}): ${event.errorMessage}`;

    case "auto_retry_end":
      if (!event.success) return `${p}${tag(RED, "retry")} All retries failed: ${event.finalError ?? "unknown error"}`;
      return undefined;

    case "queue_update":
      return undefined;

    case "session_info_changed":
      return undefined;

    case "thinking_level_changed":
      return `${p}${tag(DIM, "model")} Thinking level: ${event.level}`;

    default:
      return undefined;
  }
}
