import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { LaunchpadApiError } from "@code-review-harness/launchpad-sdk";
import { LaunchpadProvider } from "./LaunchpadProvider.js";

const url = "https://api.launchpad.net/devel/~u/+git/r/+merge/1";

function error() {
  return new LaunchpadApiError({ status: 500, url: "u", body: "b", message: "boom" });
}

function createApi() {
  return {
    getMergeProposal: vi.fn(),
    getPreviewDiffs: vi.fn(),
    getDiffFiles: vi.fn(),
    getDiffContent: vi.fn(),
    getComments: vi.fn(),
    getInlineComments: vi.fn(),
  };
}

describe("LaunchpadProvider", () => {
  it("fetches metadata, remote git, CI, and cached preview diffs", async () => {
    const api = createApi();
    api.getMergeProposal.mockResolvedValue(Result.ok({
      description: "Title",
      commit_message: "Body",
      registrant_link: "person",
      source_git_path: "refs/heads/source",
      target_git_path: "refs/heads/target",
      source_git_repository_link: "https://api.launchpad.net/devel/~u/+git/r",
    }));
    api.getPreviewDiffs.mockResolvedValue(Result.ok({ entries: [
      { self_link: "https://api.launchpad.net/devel/mp/+preview-diff/2", date_created: "2024-01-02", source_revision_id: "s2", target_revision_id: "t2" },
      { id: 1, dateCreated: "2024-01-01", sourceRevisionId: "s1", targetRevisionId: "t1" },
      { id: 4, dateCreated: "2024-01-01" },
      { id: 3 },
    ] }));
    const provider = new LaunchpadProvider({ url, api: api as never, gitdir: "/git" });

    await expect(provider.fetchMetadata()).resolves.toEqual({
      url,
      title: "Title",
      body: "Body",
      author: "person",
      sourceGitPath: "refs/heads/source",
      sourceGitRepositoryLink: "https://api.launchpad.net/devel/~u/+git/r",
      targetGitPath: "refs/heads/target",
    });
    expect(provider.remoteGit()).toMatchObject({ url: "https://git.launchpad.net/~u/+git/r", gitdir: "/git", headRef: "refs/heads/source", baseRef: "refs/heads/target" });
    await expect(provider.fetchCI()).resolves.toEqual({ checks: [] });
    await expect(provider.listPreviewDiffs()).resolves.toEqual([
      { id: 3, createdAt: "", baseRev: undefined, headRev: undefined },
      { id: 1, createdAt: "2024-01-01", baseRev: "s1", headRev: "t1" },
      { id: 4, createdAt: "2024-01-01", baseRev: undefined, headRev: undefined },
      { id: 2, createdAt: "2024-01-02", baseRev: "s2", headRev: "t2" },
    ]);
    await provider.listPreviewDiffs();
    expect(api.getPreviewDiffs).toHaveBeenCalledOnce();
  });

  it("uses metadata defaults and HEAD remote fallback", async () => {
    const api = createApi();
    api.getMergeProposal.mockResolvedValue(Result.ok({ sourceGitPath: "source", targetGitPath: "target", sourceGitRepositoryLink: "repo" }));
    const provider = new LaunchpadProvider({ url, api: api as never });

    expect(provider.remoteGit()).toMatchObject({ url: "https://git.launchpad.net/", headRef: "HEAD", baseRef: "HEAD" });
    expect(provider.remoteGit().gitdir).toContain("crh-launchpad-git-");
    await expect(provider.fetchMetadata()).resolves.toMatchObject({ title: "Launchpad merge proposal", body: "", sourceGitPath: "source", targetGitPath: "target" });
    expect(provider.remoteGit()).toMatchObject({ url: "https://git.launchpad.net/", headRef: "source", baseRef: "target" });
  });

  it("fetches diff through preview link and fallback", async () => {
    const api = createApi();
    api.getDiffFiles
      .mockResolvedValueOnce(Result.ok({ diffTextLink: "diff-link" }))
      .mockResolvedValueOnce(Result.ok({ diff_text_link: "diff-link-2" }))
      .mockResolvedValueOnce(Result.ok({}))
      .mockResolvedValueOnce(Result.err(error()));
    api.getDiffContent
      .mockResolvedValueOnce(Result.ok("diff --git a b"))
      .mockResolvedValueOnce(Result.err(error()))
      .mockResolvedValueOnce(Result.ok("fallback"))
      .mockResolvedValueOnce(Result.ok("fallback-2"))
      .mockResolvedValueOnce(Result.err(error()));
    const provider = new LaunchpadProvider({ url, api: api as never, gitdir: "/git" });

    await expect(provider.fetchDiff(1)).resolves.toBe("diff --git a b");
    await expect(provider.fetchDiff(2)).resolves.toBe("fallback");
    await expect(provider.fetchDiff(3)).resolves.toBe("fallback-2");
    await expect(provider.fetchDiff(4)).rejects.toBeInstanceOf(LaunchpadApiError);
    expect(api.getDiffContent).toHaveBeenNthCalledWith(3, "https://code.launchpad.net/~u/+git/r/+merge/1/+preview-diff/2/+files/preview.diff");
    expect(api.getDiffContent).toHaveBeenNthCalledWith(4, "https://code.launchpad.net/~u/+git/r/+merge/1/+preview-diff/3/+files/preview.diff");
    expect(api.getDiffContent).toHaveBeenNthCalledWith(5, "https://code.launchpad.net/~u/+git/r/+merge/1/+preview-diff/4/+files/preview.diff");
  });

  it("fetches comments and groups inline comments", async () => {
    const api = createApi();
    api.getComments.mockResolvedValue(Result.ok([
      { content: "before", dateCreated: "2023-01-01" },
      { content: "general", dateCreated: "2024-01-02", self_link: "g", owner_link: "o", subject: "s" },
      { dateCreated: "2024-01-03", selfLink: "g2", ownerLink: "o2" },
      { content: "no-date" },
      { content: "inline", previewdiff_link: "pd" },
    ]));
    api.getPreviewDiffs.mockResolvedValue(Result.ok({ entries: [{ id: 7, date_created: "2024-01-01" }] }));
    api.getInlineComments.mockResolvedValue(Result.ok([
      { id: "a", line_number: 5, date_created: "2024", text: "inline" },
      { id: "b", lineNumber: 6, dateCreated: "2025", content: "inline2" },
      { id: "c", lineNumber: 8 },
      { id: "d" },
    ]));
    const provider = new LaunchpadProvider({ url, api: api as never, gitdir: "/git" });

    await expect(provider.fetchCommentsForPreviewDiff(7)).resolves.toEqual({
      general: [
        { content: "general", dateCreated: "2024-01-02", id: "g", author: "o", subject: "s" },
        { content: "", dateCreated: "2024-01-03", id: "g2", author: "o2", subject: undefined },
        { content: "no-date", dateCreated: undefined, id: undefined, author: undefined, subject: undefined },
      ],
      inline: {
        "5": [{ id: "a", line: 5, previewDiffId: 7, dateCreated: "2024", content: "inline" }],
        "6": [{ id: "b", line: 6, previewDiffId: 7, dateCreated: "2025", content: "inline2" }],
        "8": [{ id: "c", line: 8, previewDiffId: 7, dateCreated: undefined, content: "" }],
        "0": [{ id: "d", line: 0, previewDiffId: 7, dateCreated: undefined, content: "" }],
      },
    });
    await provider.fetchCommentsForPreviewDiff(7);
    expect(api.getComments).toHaveBeenCalledOnce();
  });


  it("handles empty preview diff collections and inline errors", async () => {
    const api = createApi();
    api.getPreviewDiffs.mockResolvedValue(Result.ok({}));
    api.getComments.mockResolvedValue(Result.ok([]));
    api.getInlineComments.mockResolvedValue(Result.err(error()));
    const provider = new LaunchpadProvider({ url, api: api as never, gitdir: "/git" });

    await expect(provider.listPreviewDiffs()).resolves.toEqual([]);
    await expect(provider.fetchCommentsForPreviewDiff(1)).rejects.toBeInstanceOf(LaunchpadApiError);
  });

  it("throws provider API errors", async () => {
    const api = createApi();
    api.getMergeProposal.mockResolvedValue(Result.err(error()));
    api.getPreviewDiffs.mockResolvedValue(Result.err(error()));
    api.getComments.mockResolvedValue(Result.err(error()));
    api.getInlineComments.mockResolvedValue(Result.err(error()));
    const provider = new LaunchpadProvider({ url, api: api as never, gitdir: "/git" });

    await expect(provider.fetchMetadata()).rejects.toBeInstanceOf(LaunchpadApiError);
    await expect(provider.listPreviewDiffs()).rejects.toBeInstanceOf(LaunchpadApiError);
    await expect(provider.fetchCommentsForPreviewDiff(1)).rejects.toBeInstanceOf(LaunchpadApiError);
  });
});
