import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { prepareWorkspace } from "./prepareWorkspace.js";
import { createRepoFileOps } from "./createRepoFileOps.js";
import { createPrTools } from "./createPrTools.js";
import { createDelegateReviewTool } from "./createDelegateReviewTool.js";
import { createSubmitReviewTool } from "./createSubmitReviewTool.js";
import { defaultReviewerPrompt } from "./defaultReviewerPrompt.js";
import type { CreateReviewSessionOptions, ReviewSessionHandle } from "./types.js";

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
  ];
  const { session } = await createAgentSession({
    cwd: workspace,
    model: options.model,
    tools: ["read", "grep", "find", "ls", ...customTools.map((tool) => tool.name)],
    customTools,
    resourceLoader,
    sessionManager: SessionManager.inMemory(workspace),
    settingsManager,
  });

  return { session, workspace, gitdir };
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
