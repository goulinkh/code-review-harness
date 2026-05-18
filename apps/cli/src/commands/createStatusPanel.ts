import type { AgentSessionEvent } from "@code-review-harness/core";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";

interface PanelState {
  phase: string;
  running: Map<number, string>;
  changedFiles: Set<string>;
  reviewedFiles: Set<string>;
  submitted: boolean;
  totalTokens: number;
}

interface StatusPanel {
  setPhase(phase: string): void;
  setChangedFiles(files: string[]): void;
  handle(event: AgentSessionEvent, scopeSlot?: number, scopeText?: string): void;
  redraw(): void;
  dispose(): void;
}

function getVisibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function fit(s: string, cols: number): string {
  const len = getVisibleLength(s);
  if (len <= cols) return s + " ".repeat(cols - len);
  // ANSI-safe truncation: just strip codes if overflow (rare path)
  const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
  return plain.slice(0, cols);
}

/**
 * @note Impure — installs ANSI scroll region on the given TTY stream, reserves
 * 2 bottom lines as a fixed status panel. Falls back to no-op on non-TTY.
 */
export function createStatusPanel(stream: NodeJS.WriteStream): StatusPanel {
  const isTty = Boolean(stream.isTTY);
  const state: PanelState = {
    phase: "Initializing",
    running: new Map(),
    changedFiles: new Set(),
    reviewedFiles: new Set(),
    submitted: false,
    totalTokens: 0,
  };

  function getRows(): number {
    return stream.rows ?? 24;
  }
  function getCols(): number {
    return stream.columns ?? 80;
  }

  function install(): void {
    if (!isTty) return;
    const rows = getRows();
    // Reserve last 2 lines: scroll region 1..rows-2
    stream.write(`\x1b[1;${rows - 2}r`);
    // Move cursor into scroll region
    stream.write(`\x1b[${rows - 2};1H`);
  }

  function reset(): void {
    if (!isTty) return;
    const rows = getRows();
    // Clear panel lines
    stream.write(`\x1b7`); // save
    stream.write(`\x1b[${rows - 1};1H\x1b[2K`);
    stream.write(`\x1b[${rows};1H\x1b[2K`);
    // Reset scroll region
    stream.write(`\x1b[r`);
    stream.write(`\x1b8`); // restore
  }

  function reviewedCount(): number {
    if (state.changedFiles.size === 0) return state.reviewedFiles.size;
    return Math.min(state.reviewedFiles.size, state.changedFiles.size);
  }

  function calculatePercent(): number | null {
    if (state.submitted) return 100;
    if (state.changedFiles.size === 0) return null;
    const pct = (reviewedCount() / state.changedFiles.size) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  function formatTokens(n: number): string {
    if (n === 0) return "";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k tok`;
    return `${n} tok`;
  }

  function formatPercent(pct: number): string {
    if (pct >= 100) return "100%";
    if (pct <= 0) return "0.0%";
    return `${pct.toFixed(1)}%`;
  }

  function renderProgressBar(pct: number, width: number): string {
    const clamped = Math.max(0, Math.min(100, pct));
    const filled = Math.round((clamped / 100) * width);
    const bar = "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
    return `${GREEN}${bar}${RESET}`;
  }

  function renderLines(): [string, string] {
    const cols = getCols();
    const pct = calculatePercent();
    const running = state.running.size;
    const filesLabel = state.changedFiles.size > 0 ? `${reviewedCount()}/${state.changedFiles.size}` : "—";

    const leftPrefix = `${DIM}┌${RESET} `;
    const leftCore =
      `${BOLD}${CYAN}${state.phase}${RESET}` +
      `  ${MAGENTA}● ${running} sub${running === 1 ? "" : "s"}${RESET}` +
      `  ${DIM}files ${filesLabel}${RESET}`;
    const left = `${leftPrefix}${leftCore}`;

    let line1: string;
    const tokLabel = formatTokens(state.totalTokens);
    if (pct === null) {
      const tokPart = tokLabel ? `  ${DIM}${tokLabel}${RESET}` : "";
      const cornerSuffix = ` ${DIM}┐${RESET}`;
      const right = `${tokPart}${cornerSuffix}`;
      const pad = Math.max(0, cols - getVisibleLength(left) - getVisibleLength(right));
      line1 = `${left}${" ".repeat(pad)}${right}`;
    } else {
      const pctLabel = formatPercent(pct);
      const MAX_BAR = 40;
      const MIN_BAR = 8;
      const cornerSuffix = ` ${DIM}┐${RESET}`;
      const tokPart = tokLabel ? `  ${DIM}${tokLabel}${RESET}` : "";
      const pctSuffix = ` ${YELLOW}${pctLabel}${RESET}${tokPart}${cornerSuffix}`;
      const available = cols - getVisibleLength(left) - getVisibleLength(pctSuffix) - 1; // 1 space before bar
      const barWidth = Math.max(MIN_BAR, Math.min(MAX_BAR, available));
      const bar = renderProgressBar(pct, barWidth);
      const right = `${bar}${pctSuffix}`;
      const pad = Math.max(0, cols - getVisibleLength(left) - getVisibleLength(right));
      line1 = `${left}${" ".repeat(pad)}${right}`;
    }

    const slots = Array.from(state.running.entries())
      .map(([slot, scope]) => `${MAGENTA}#${slot}${RESET} ${DIM}${scope}${RESET}`)
      .join("  ");
    const line2 = `${DIM}└${RESET} ${slots || `${DIM}(idle)${RESET}`}`;

    return [fit(line1, cols), fit(line2, cols)];
  }

  function redraw(): void {
    if (!isTty) return;
    const rows = getRows();
    const [l1, l2] = renderLines();
    stream.write(`\x1b7`); // save cursor
    stream.write(`\x1b[${rows - 1};1H\x1b[2K${l1}`);
    stream.write(`\x1b[${rows};1H\x1b[2K${l2}`);
    stream.write(`\x1b8`); // restore cursor
  }

  function handle(event: AgentSessionEvent, scopeSlot?: number, scopeText?: string): void {
    let changed = false;
    switch (event.type) {
      case "agent_start":
        if (scopeSlot !== undefined) {
          state.running.set(scopeSlot, truncate(scopeText ?? `slot ${scopeSlot}`, 40));
          changed = true;
        } else if (state.phase === "Initializing") {
          state.phase = "Reviewing";
          changed = true;
        }
        break;
      case "agent_end":
        if (scopeSlot !== undefined && state.running.delete(scopeSlot)) {
          changed = true;
        }
        break;
      case "tool_execution_start": {
        if (event.toolName === "delegate_review" && scopeSlot === undefined) {
          state.phase = "Delegating review";
          changed = true;
        } else if (event.toolName === "submit_review") {
          state.phase = "Submitting review";
          changed = true;
        } else if (event.toolName === "mark_file_reviewed") {
          const path = extractPath(event.args);
          if (path && !state.reviewedFiles.has(path)) {
            state.reviewedFiles.add(path);
            changed = true;
          }
        }
        break;
      }
      case "message_end": {
        const msg = event.message as { role?: string; usage?: { totalTokens?: number } };
        if (msg.role === "assistant" && typeof msg.usage?.totalTokens === "number") {
          state.totalTokens += msg.usage.totalTokens;
          changed = true;
        }
        break;
      }
      case "tool_execution_end":
        if (event.toolName === "submit_review" && !event.isError) {
          state.submitted = true;
          state.phase = "Done";
          changed = true;
        }
        break;
      default:
        break;
    }
    if (changed) redraw();
  }

  function setPhase(phase: string): void {
    state.phase = phase;
    redraw();
  }

  function setChangedFiles(files: string[]): void {
    state.changedFiles = new Set(files);
    redraw();
  }

  function dispose(): void {
    reset();
  }

  if (isTty) {
    install();
    redraw();
    stream.on("resize", () => {
      install();
      redraw();
    });
  }

  return { setPhase, setChangedFiles, handle, redraw, dispose };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function extractPath(args: unknown): string | undefined {
  const obj = typeof args === "string" ? safeParse(args) : args;
  if (!obj || typeof obj !== "object") return undefined;
  const value = (obj as Record<string, unknown>)["path"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
