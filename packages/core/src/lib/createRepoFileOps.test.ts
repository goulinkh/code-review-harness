import { describe, expect, it, vi } from "vitest";

const gitMock = vi.hoisted(() => ({
  resolveRef: vi.fn(),
  readTree: vi.fn(),
  readBlob: vi.fn(),
  walk: vi.fn(),
  TREE: vi.fn((value) => value),
}));

vi.mock("isomorphic-git", () => ({ default: gitMock }));

import { createRepoFileOps } from "./createRepoFileOps.js";
import type { ReviewProvider } from "./types.js";

function provider(): ReviewProvider {
  return {
    id: "p",
    fetchMetadata: vi.fn(),
    listPreviewDiffs: vi.fn(),
    fetchDiff: vi.fn(),
    fetchCommentsForPreviewDiff: vi.fn(),
    fetchCI: vi.fn(),
    remoteGit: () => ({ url: "url", gitdir: "/git", http: {} as never, headRef: "HEAD", baseRef: "BASE" }),
  };
}

async function callTool(name: string, params: Record<string, unknown> = {}) {
  const tool = createRepoFileOps(provider()).find((entry) => entry.name === name)!;
  return tool.execute("call", params);
}

describe("createRepoFileOps", () => {
  it("lists tree entries", async () => {
    gitMock.resolveRef.mockResolvedValue("oid");
    gitMock.readTree.mockResolvedValue({ tree: [{ path: "b", mode: "100644", oid: "2", type: "blob" }, { path: "a", mode: "100644", oid: "1", type: "blob" }] });
    await expect(callTool("repo_ls", { path: "/", ref: "main" })).resolves.toMatchObject({ details: [{ path: "a" }, { path: "b" }] });
    await expect(callTool("repo_ls", { path: "/src", ref: "main" })).resolves.toMatchObject({ details: [{ path: "a" }, { path: "b" }] });
  });

  it("reads blobs and stats files", async () => {
    gitMock.resolveRef.mockResolvedValue("oid");
    gitMock.readBlob.mockResolvedValue({ oid: "blob", blob: new TextEncoder().encode("hello") });
    await expect(callTool("repo_read", { path: "a.ts" })).resolves.toMatchObject({ details: { content: "hello", totalLines: 1, startLine: 1, endLine: 1, truncated: false } });
    await expect(callTool("repo_stat", { path: "a.ts" })).resolves.toMatchObject({ details: { oid: "blob", size: 5 } });
  });

  it("greps blob content", async () => {
    gitMock.resolveRef.mockResolvedValue("oid");
    gitMock.walk.mockImplementation(async ({ map }) => [
      await map(".", [undefined]),
      await map("skip.txt", [{ type: async () => "blob", content: async () => new TextEncoder().encode("hit") }]),
      await map("dir/a.txt", [{ type: async () => "tree" }]),
      await map("dir/b.txt", [{ type: async () => "blob", content: async () => new TextEncoder().encode("one\nhit") }]),
      await map("dir/c.txt", [{ type: async () => "blob", content: async () => undefined }]),
    ]);
    await expect(callTool("repo_grep", { pattern: "hit", pathGlob: "dir" })).resolves.toMatchObject({ details: { matches: [{ path: "dir/b.txt", line: 2, text: "hit" }], truncated: false } });
  });


  it("returns no grep matches when blobs do not match", async () => {
    gitMock.resolveRef.mockResolvedValue("oid");
    gitMock.walk.mockImplementation(async ({ map }) => [
      await map("dir/nohit.txt", [{ type: async () => "blob", content: async () => new TextEncoder().encode("miss") }]),
    ]);

    await expect(callTool("repo_grep", { pattern: "hit" })).resolves.toMatchObject({ details: { matches: [], truncated: false } });
  });

  it("throws git errors from tool execution", async () => {
    gitMock.resolveRef.mockRejectedValue(new Error("bad ref"));
    await expect(callTool("repo_ls")).rejects.toThrow(/Could not resolve ref/);
  });

  it("falls back to refs/remotes/origin when refs/heads is missing", async () => {
    gitMock.resolveRef.mockImplementation(async ({ ref }: { ref: string }) => {
      if (ref === "refs/remotes/origin/feat/x") return "oid";
      throw new Error(`Could not find ${ref}`);
    });
    gitMock.readBlob.mockResolvedValue({ oid: "blob", blob: new TextEncoder().encode("hi") });
    await expect(callTool("repo_read", { path: "a.ts", ref: "refs/heads/feat/x" })).resolves.toMatchObject({ details: { content: "hi" } });
  });
});
