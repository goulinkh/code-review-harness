import { mkdtemp, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const gitMock = vi.hoisted(() => ({
  resolveRef: vi.fn(),
  readBlob: vi.fn(),
  walk: vi.fn(),
  clone: vi.fn(),
  TREE: vi.fn((value) => value),
}));

vi.mock("isomorphic-git", () => ({ default: gitMock }));

import { prepareWorkspace } from "./prepareWorkspace.js";
import type { ReviewProvider } from "./types.js";

const rawDiff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`;

function createProvider(): ReviewProvider {
  return {
    id: "provider",
    fetchMetadata: vi.fn(async () => ({ url: "url", title: "Title", body: "Body" })),
    fetchCI: vi.fn(async () => ({ checks: [] })),
    listPreviewDiffs: vi.fn(async () => [{ id: 2, createdAt: "2024-01-02" }, { id: 1, createdAt: "2024-01-01" }]),
    fetchDiff: vi.fn(async () => rawDiff),
    fetchCommentsForPreviewDiff: vi.fn(async (id: number) => ({ general: [{ content: `g${id}` }], inline: { "7": [{ content: "i", line: 7, previewDiffId: id }] } })),
    remoteGit: () => ({ url: "git-url", gitdir: "/git", http: {} as never, headRef: "HEAD", baseRef: "BASE" }),
  };
}

describe("prepareWorkspace", () => {
  it("materializes deterministic review workspace", async () => {
    gitMock.resolveRef.mockResolvedValue("oid");
    gitMock.readBlob.mockImplementation(async ({ filepath }) => ({ blob: new TextEncoder().encode(`content:${filepath}`) }));
    gitMock.walk.mockImplementation(async ({ map }) => [
      await map(".", [undefined]),
      await map(".cursor/rules/rule.md", [{ type: async () => "blob" }]),
      await map(".cursor/rules/dir", [{ type: async () => "tree" }]),
      await map(".clinerules/rule", [{ type: async () => "blob" }]),
      await map(".crh/skills/skill.md", [{ type: async () => "blob" }]),
      await map(".crh/skills/skip.txt", [{ type: async () => "blob" }]),
      await map("src/a.ts", [{ type: async () => "blob" }]),
    ]);

    const root = await mkdtemp(join(tmpdir(), "crh-workspace-test-"));
    await expect(prepareWorkspace(createProvider(), { root })).resolves.toEqual({ root, latestPreviewDiffId: 2 });

    await expect(readFile(join(root, "description.md"), "utf8")).resolves.toBe("# Title\n\nBody\n");
    await expect(readlink(join(root, "preview-diffs", "latest"))).resolves.toBe("2");
    await expect(readFile(join(root, "agent", "AGENTS.md"), "utf8")).resolves.toBe("content:AGENTS.md");
    await expect(readFile(join(root, "agent", "rules", "rule.md"), "utf8")).resolves.toBe("content:.cursor/rules/rule.md");
    await expect(readFile(join(root, "agent", "rules", "rule"), "utf8")).resolves.toBe("content:.clinerules/rule");
    await expect(readFile(join(root, "agent", "skills", "skill.md"), "utf8")).resolves.toBe("content:.crh/skills/skill.md");
    await expect(readFile(join(root, "preview-diffs", "2", "diff", "files", "src", "a.ts", "patch"), "utf8")).resolves.toContain("+new");
    await expect(readFile(join(root, "preview-diffs", "1", "comments", "inline", "7.json"), "utf8")).resolves.toContain("\"previewDiffId\": 1");
  });


  it("normalizes preview diff ordering and trailing newlines", async () => {
    gitMock.resolveRef.mockResolvedValue("oid");
    gitMock.readBlob.mockRejectedValue(new Error("missing blob"));
    gitMock.walk.mockResolvedValue([]);
    const diffWithoutTrailingNewline = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new`;
    const provider = {
      ...createProvider(),
      listPreviewDiffs: vi.fn(async () => [{ id: 3, createdAt: "2024-01-01" }, { id: 2, createdAt: "2024-01-01" }]),
      fetchDiff: vi.fn(async () => diffWithoutTrailingNewline),
      fetchCommentsForPreviewDiff: vi.fn(async () => ({ general: [], inline: { "10": [], "2": [] } })),
    };

    const root = await mkdtemp(join(tmpdir(), "crh-workspace-newline-"));
    await prepareWorkspace(provider, { root });

    await expect(readFile(join(root, "preview-diffs", "index.json"), "utf8")).resolves.toContain('"id": 2');
    await expect(readlink(join(root, "preview-diffs", "latest"))).resolves.toBe("3");
    await expect(readFile(join(root, "preview-diffs", "2", "diff", "raw.diff"), "utf8")).resolves.toBe(`${diffWithoutTrailingNewline}\n`);
    await expect(readFile(join(root, "preview-diffs", "2", "diff", "files", "src", "a.ts", "patch"), "utf8")).resolves.toBe("@@ -1 +1 @@\n-old\n+new\n");
    await expect(readFile(join(root, "preview-diffs", "2", "comments", "inline", "2.json"), "utf8")).resolves.toBe("[]\n");
  });


  it("skips missing agent tree directories", async () => {
    gitMock.resolveRef.mockResolvedValue("oid");
    gitMock.readBlob.mockRejectedValue(new Error("missing blob"));
    gitMock.walk.mockRejectedValue(new Error("missing tree"));

    const root = await mkdtemp(join(tmpdir(), "crh-workspace-missing-agent-tree-"));
    await expect(prepareWorkspace({ ...createProvider(), listPreviewDiffs: vi.fn(async () => []) }, { root })).resolves.toEqual({ root, latestPreviewDiffId: undefined });
  });

  it("clones when git objects are missing", async () => {
    gitMock.resolveRef.mockRejectedValueOnce(new Error("missing")).mockResolvedValue("oid");
    gitMock.readBlob.mockRejectedValue(new Error("missing blob"));
    gitMock.walk.mockResolvedValue([]);

    const root = await mkdtemp(join(tmpdir(), "crh-workspace-clone-"));
    await prepareWorkspace({ ...createProvider(), listPreviewDiffs: vi.fn(async () => []) }, { root });
    expect(gitMock.clone).toHaveBeenCalledWith(expect.objectContaining({ url: "git-url", depth: 50, noCheckout: true, singleBranch: false }));
  });
});
