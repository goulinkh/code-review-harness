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
  totalSlices: number;
  completedSlices: number;
  submitted: boolean;
}

interface StatusPanel {
  setPhase(phase: string): void;
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
    totalSlices: 0,
    completedSlices: 0,
    submitted: false,
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

  function calculatePercent(): number | null {
    if (state.submitted) return 100;
    if (state.totalSlices === 0) return null;
    const pct = (state.completedSlices / state.totalSlices) * 100;
    return Math.max(0, Math.min(100, pct));
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
    const slicesLabel = state.totalSlices > 0 ? `${state.completedSlices}/${state.totalSlices}` : "—";

    const leftPrefix = `${DIM}┌${RESET} `;
    const leftCore =
      `${BOLD}${CYAN}${state.phase}${RESET}` +
      `  ${MAGENTA}● ${running} sub${running === 1 ? "" : "s"}${RESET}` +
      `  ${DIM}slices ${slicesLabel}${RESET}`;
    const left = `${leftPrefix}${leftCore}`;

    let line1: string;
    if (pct === null) {
      line1 = `${left}${" ".repeat(Math.max(0, cols - getVisibleLength(left) - 1))}${DIM}┐${RESET}`;
    } else {
      const pctLabel = formatPercent(pct);
      const MAX_BAR = 40;
      const MIN_BAR = 8;
      const cornerSuffix = ` ${DIM}┐${RESET}`;
      const pctSuffix = ` ${YELLOW}${pctLabel}${RESET}${cornerSuffix}`;
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
          const isNew = !state.running.has(scopeSlot);
          state.running.set(scopeSlot, truncate(scopeText ?? `slot ${scopeSlot}`, 40));
          if (isNew) {
            const minTotal = state.completedSlices + state.running.size;
            if (minTotal > state.totalSlices) state.totalSlices = minTotal;
          }
          changed = true;
        } else if (state.phase === "Initializing") {
          state.phase = "Reviewing";
          changed = true;
        }
        break;
      case "agent_end":
        if (scopeSlot !== undefined && state.running.delete(scopeSlot)) {
          const cap = Math.max(state.totalSlices, state.completedSlices + state.running.size + 1);
          state.completedSlices = Math.min(cap, state.completedSlices + 1);
          if (state.totalSlices < state.completedSlices) state.totalSlices = state.completedSlices;
          changed = true;
        }
        break;
      case "tool_execution_start": {
        if (event.toolName === "delegate_review" && scopeSlot === undefined) {
          const scopes = extractScopes(event.args);
          if (scopes > 0) {
            state.totalSlices += scopes;
            changed = true;
          }
          state.phase = "Delegating review";
          changed = true;
        } else if (event.toolName === "submit_review") {
          state.phase = "Submitting review";
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

  return { setPhase, handle, redraw, dispose };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function extractScopes(args: unknown): number {
  if (!args || typeof args !== "object") return 0;
  const a = args as Record<string, unknown>;
  if (Array.isArray(a["scopes"])) return a["scopes"].length;
  if (a["scope"]) return 1;
  return 0;
}
