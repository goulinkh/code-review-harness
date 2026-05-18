import { mkdtemp, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type ResourceLoader, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { prepareWorkspace } from "./prepareWorkspace.js";
import { createRepoFileOps } from "./createRepoFileOps.js";
import { createPrTools } from "./createPrTools.js";
import { createDelegateReviewTool } from "./createDelegateReviewTool.js";
import { createSubmitReviewTool } from "./createSubmitReviewTool.js";
import { defaultReviewerPrompt } from "./defaultReviewerPrompt.js";
import type { CreateReviewSessionOptions, ReviewSessionHandle } from "./types.js";

const TOOL_CALL_TIMEOUT_MS = 10_000;

function withTimeout<T extends ToolDefinition>(tool: T, ms: number): T {
  if (typeof tool?.execute !== "function") return tool;
  const original = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`tool ${tool.name} timed out after ${ms}ms`);
          controller.abort(error);
          reject(error);
        }, ms);
      });
      try {
        return await Promise.race([original(toolCallId, params, controller.signal, onUpdate, ctx), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  } as T;
}

/**
 * @note Impure — creates temp directories, writes workspace files, and starts a networked agent session.
 */
export async function createReviewSession(options: CreateReviewSessionOptions): Promise<ReviewSessionHandle> {
  const workspace = options.workspace ?? await mkdtemp(join(tmpdir(), "crh-workspace-"));
  const gitdir = options.gitdir ?? options.provider.remoteGit().gitdir ?? await mkdtemp(join(tmpdir(), "crh-git-"));
  await prepareWorkspace(options.provider, { root: workspace, onProgress: options.workspaceProgress });

  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true } });
  const resourceLoader = createResourceLoader(workspace, settingsManager, options.systemPrompt ?? defaultReviewerPrompt);
  await resourceLoader.reload();

  const customTools = [
    ...createRepoFileOps(options.provider),
    ...createPrTools(workspace),
    createDelegateReviewTool({ workspace, provider: options.provider, model: options.model, systemPrompt: options.subAgentSystemPrompt, onChildEvent: options.onChildEvent }),
    createSubmitReviewTool(options.sink, { provider: options.provider, workspace }),
  ].map((tool) => withTimeout(tool, TOOL_CALL_TIMEOUT_MS));
  const { session } = await createAgentSession({
    cwd: workspace,
    model: options.model,
    tools: ["read", "grep", "find", "ls", ...customTools.map((tool) => tool.name)],
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(workspace),
    settingsManager,
  });

  const changedFilesCount = await countChangedFiles(workspace);

  return { session, workspace, gitdir, changedFilesCount };
}

async function countChangedFiles(workspace: string): Promise<number> {
  try {
    const target = await readlink(join(workspace, "preview-diffs", "latest"));
    const filesRoot = join(workspace, "preview-diffs", target, "diff", "files");
    return await countMetaFiles(filesRoot);
  } catch {
    return 0;
  }
}

async function countMetaFiles(dir: string): Promise<number> {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countMetaFiles(join(dir, entry.name));
    } else if (entry.name === "meta.json") {
      count += 1;
    }
  }
  return count;
}

function createResourceLoader(workspace: string, settingsManager: SettingsManager, systemPrompt: string): ResourceLoader {
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
