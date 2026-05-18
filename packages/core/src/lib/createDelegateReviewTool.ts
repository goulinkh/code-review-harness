import { Type, type Static } from "@sinclair/typebox";
import {
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createRepoFileOps } from "./createRepoFileOps.js";
import { createPrTools } from "./createPrTools.js";
import { defaultSubReviewerPrompt } from "./defaultReviewerPrompt.js";
import type { DelegateChildContext, ReviewProvider } from "./types.js";

export type { DelegateChildContext };

export const FindingsSchema = Type.Object({
  findings: Type.Array(
    Type.Object({
      severity: Type.Union([Type.Literal("blocker"), Type.Literal("major"), Type.Literal("minor"), Type.Literal("nit"), Type.Literal("info")]),
      path: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
      comment: Type.String(),
    }),
  ),
  summary: Type.String(),
});
export type Findings = Static<typeof FindingsSchema>;

export interface DelegateReviewToolOptions {
  workspace: string;
  provider: ReviewProvider;
  model?: Model<any>;
  systemPrompt?: string;
  onChildEvent?: (event: AgentSessionEvent, ctx: DelegateChildContext) => void;
}

const SliceSchema = Type.Object({
  scope: Type.String({ description: "What the sub-agent must review (e.g. 'file: src/foo.ts', 'module: auth', 'lines 200-450 of numbered.diff')." }),
  focus: Type.Optional(Type.String({ description: "Optional extra guidance (security, perf, naming, etc.)." })),
  previewDiffId: Type.Optional(Type.Number()),
});

/**
 * @note Impure — spawns ephemeral child agent session per delegation call.
 * Each call has its own context window so large reviews can be fanned out by file/module/range.
 */
export function createDelegateReviewTool(options: DelegateReviewToolOptions): ToolDefinition {
  let slotCounter = 0;
  return defineTool({
    name: "delegate_review",
    label: "delegate_review",
    description:
      "Delegate review of one or many scoped slices to fresh sub-agents that run in parallel. Pass `scopes` (array) to fan out N children in a single call — preferred for multi-file diffs. Pass `scope` for a single slice. Each sub-agent has its own context window and returns structured findings.",
    parameters: Type.Object({
      scope: Type.Optional(SliceSchema.properties.scope),
      focus: Type.Optional(SliceSchema.properties.focus),
      previewDiffId: Type.Optional(SliceSchema.properties.previewDiffId),
      scopes: Type.Optional(Type.Array(SliceSchema, { description: "Batch of slices to dispatch concurrently. Use this for multi-file diffs instead of issuing many one-scope calls." })),
    }),
    executionMode: "parallel",
    async execute(_toolCallId, params) {
      const p = params as { scope?: string; focus?: string; previewDiffId?: number; scopes?: Array<{ scope: string; focus?: string; previewDiffId?: number }> };
      const slices = p.scopes && p.scopes.length > 0
        ? p.scopes
        : p.scope
          ? [{ scope: p.scope, focus: p.focus, previewDiffId: p.previewDiffId }]
          : [];
      if (slices.length === 0) {
        const empty: Findings = { findings: [], summary: "delegate_review called with no scope or scopes" };
        return { content: [{ type: "text", text: JSON.stringify(empty, null, 2) }], details: empty };
      }
      const results = await Promise.all(
        slices.map(async (s) => {
          const slot = ++slotCounter;
          const findings = await runChildReview(options, s, { slot, scope: s.scope, focus: s.focus });
          return { slot, scope: s.scope, findings };
        }),
      );
      const merged: Findings = {
        findings: results.flatMap((r) => r.findings.findings),
        summary: results.map((r) => `[${r.slot}] ${r.scope}: ${r.findings.summary}`).join("\n"),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(merged, null, 2) }],
        details: merged,
      };
    },
  });
}

async function runChildReview(options: DelegateReviewToolOptions, params: { scope: string; focus?: string; previewDiffId?: number }, ctx: DelegateChildContext): Promise<Findings> {
  let captured: Findings | undefined;
  const reportTool = defineTool({
    name: "report_findings",
    label: "report_findings",
    description: "Submit findings for this delegated slice and end sub-session. MUST be called once with strict JSON conforming to the schema.",
    parameters: FindingsSchema,
    executionMode: "sequential",
    async execute(_id, p) {
      captured = p as Findings;
      return { content: [{ type: "text", text: "findings recorded" }], details: captured, terminate: true };
    },
  });

  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true } });
  const resourceLoader = createChildResourceLoader(options.workspace, settingsManager, options.systemPrompt ?? defaultSubReviewerPrompt);
  await resourceLoader.reload();

  const customTools = [...createRepoFileOps(options.provider), ...createPrTools(options.workspace), reportTool];
  const { session } = await createAgentSession({
    cwd: options.workspace,
    model: options.model,
    tools: ["read", "grep", "find", "ls", ...customTools.map((tool) => tool.name)],
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(options.workspace),
    settingsManager,
  });

  if (options.onChildEvent) {
    const forward = options.onChildEvent;
    session.subscribe((event) => forward(event, ctx));
  }

  const focus = params.focus ? `\nFocus: ${params.focus}` : "";
  const diffId = params.previewDiffId !== undefined ? `\npreviewDiffId: ${params.previewDiffId}` : "";
  await session.prompt(
    `You are a sub-reviewer for a delegated slice.\nScope: ${params.scope}${focus}${diffId}\n\nInspect only the scope. Use diff_get_file / diff_numbered / repo_read / grep as needed. When done, call report_findings exactly once with strict JSON. Do not chat. Do not call any tool after report_findings.`,
  );

  if (!captured) {
    return { findings: [], summary: "sub-agent ended without calling report_findings" };
  }
  return captured;
}

function createChildResourceLoader(workspace: string, settingsManager: SettingsManager, systemPrompt: string): ResourceLoader {
  return new DefaultResourceLoader({
    cwd: workspace,
    agentDir: workspace,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
    skillsOverride: () => ({ skills: [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: [], diagnostics: [] }),
    themesOverride: () => ({ themes: [], diagnostics: [] }),
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  });
}
