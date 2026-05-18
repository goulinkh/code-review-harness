import { describe, expect, it, vi } from "vitest";

const piMock = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  DefaultResourceLoader: vi.fn(function ResourceLoader(this: { reload: () => Promise<void> }, options: unknown) {
    Object.assign(this, { options, reload: vi.fn(async () => undefined) });
  }),
  SessionManager: { inMemory: vi.fn((cwd: string) => ({ cwd })) },
  SettingsManager: { inMemory: vi.fn((settings: unknown) => ({ settings })) },
}));
const prepareWorkspaceMock = vi.hoisted(() => vi.fn(async () => undefined));
const createRepoFileOpsMock = vi.hoisted(() => vi.fn(() => [{ name: "repo_read" }]));
const createPrToolsMock = vi.hoisted(() => vi.fn(() => [{ name: "mp_metadata" }]));
const createSubmitReviewToolMock = vi.hoisted(() => vi.fn(() => ({ name: "submit_review" })));
const createDelegateReviewToolMock = vi.hoisted(() => vi.fn(() => ({ name: "delegate_review" })));

vi.mock("@earendil-works/pi-coding-agent", () => piMock);
vi.mock("./prepareWorkspace.js", () => ({ prepareWorkspace: prepareWorkspaceMock }));
vi.mock("./createRepoFileOps.js", () => ({ createRepoFileOps: createRepoFileOpsMock }));
vi.mock("./createPrTools.js", () => ({ createPrTools: createPrToolsMock }));
vi.mock("./createSubmitReviewTool.js", () => ({ createSubmitReviewTool: createSubmitReviewToolMock }));
vi.mock("./createDelegateReviewTool.js", () => ({ createDelegateReviewTool: createDelegateReviewToolMock }));

import { createReviewSession } from "./createReviewSession.js";
import type { ReviewProvider, ReviewSink } from "./types.js";

describe("createReviewSession", () => {
  it("prepares workspace and wires agent session", async () => {
    const session = { prompt: vi.fn() };
    piMock.createAgentSession.mockResolvedValue({ session });
    const provider = { id: "p", remoteGit: () => ({ gitdir: "/git" }) } as ReviewProvider;
    const sink = { id: "s" } as ReviewSink;

    await expect(createReviewSession({ provider, sink, workspace: "/workspace", systemPrompt: "prompt" })).resolves.toEqual({ session, workspace: "/workspace", gitdir: "/git" });
    expect(prepareWorkspaceMock).toHaveBeenCalledWith(provider, { root: "/workspace" });
    expect(piMock.createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/workspace",
      tools: ["read", "grep", "find", "ls", "repo_read", "mp_metadata", "delegate_review", "submit_review"],
      customTools: [{ name: "repo_read" }, { name: "mp_metadata" }, { name: "delegate_review" }, { name: "submit_review" }],
    }));
    const loader = piMock.DefaultResourceLoader.mock.instances[0] as { options: Record<string, () => unknown> };
    expect(loader.options.skillsOverride()).toEqual({ skills: [], diagnostics: [] });
    expect(loader.options.promptsOverride()).toEqual({ prompts: [], diagnostics: [] });
    expect(loader.options.themesOverride()).toEqual({ themes: [], diagnostics: [] });
    expect(loader.options.agentsFilesOverride()).toEqual({ agentsFiles: [] });
  });

  it("uses default workspace, gitdir, and prompt", async () => {
    const session = { prompt: vi.fn() };
    piMock.createAgentSession.mockResolvedValue({ session });
    const provider = { id: "p", remoteGit: () => ({}) } as unknown as ReviewProvider;
    const sink = { id: "s" } as ReviewSink;

    const result = await createReviewSession({ provider, sink });

    expect(result.workspace).toContain("crh-workspace-");
    expect(result.gitdir).toContain("crh-git-");
    expect(prepareWorkspaceMock).toHaveBeenCalledWith(provider, { root: result.workspace });
    expect(piMock.DefaultResourceLoader).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: result.workspace }));
  });

});
