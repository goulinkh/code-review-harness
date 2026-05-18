import { promises as fs } from "node:fs";
import git from "isomorphic-git";
import { Type } from "@sinclair/typebox";
import { Result } from "better-result";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ReviewProvider } from "./types.js";

/** @note Impure — creates tools whose executions read git objects from the filesystem. */
export function createRepoFileOps(provider: ReviewProvider): ToolDefinition[] {
  const remote = provider.remoteGit();
  return [
    defineRepoTool("repo_ls", "List repository tree entries", Type.Object({ path: Type.Optional(Type.String()), ref: Type.Optional(Type.String()) }), async (params) => {
      const oid = await resolveGitRef(remote.gitdir, params.ref ?? remote.headRef);
      const entries = await git.readTree({ fs, gitdir: remote.gitdir, oid, filepath: normalizeRepoPath(params.path) });
      return entries.tree.map((entry) => ({ path: entry.path, mode: entry.mode, oid: entry.oid, type: entry.type })).sort((left, right) => left.path.localeCompare(right.path));
    }),
    defineRepoTool("repo_read", "Read repository file", Type.Object({ path: Type.String(), ref: Type.Optional(Type.String()) }), async (params) => {
      const oid = await resolveGitRef(remote.gitdir, params.ref ?? remote.headRef);
      const blob = await git.readBlob({ fs, gitdir: remote.gitdir, oid, filepath: params.path });
      return new TextDecoder().decode(blob.blob);
    }),
    defineRepoTool("repo_grep", "Search repository blobs with regex", Type.Object({ pattern: Type.String(), pathGlob: Type.Optional(Type.String()), ref: Type.Optional(Type.String()) }), async (params) => {
      const regex = new RegExp(params.pattern);
      const oid = await resolveGitRef(remote.gitdir, params.ref ?? remote.headRef);
      const matches = await git.walk({
        fs,
        gitdir: remote.gitdir,
        trees: [git.TREE({ ref: oid })],
        map: async (filepath, [entry]) => {
          if (!entry || filepath === ".") return undefined;
          if (params.pathGlob && !filepath.includes(params.pathGlob)) return undefined;
          if ((await entry.type()) !== "blob") return undefined;
          const blob = await entry.content();
          if (!blob) return undefined;
          const text = new TextDecoder().decode(blob);
          const lines = text.split("\n");
          const hits = lines.flatMap((line: string, index: number) => regex.test(line) ? [{ path: filepath, line: index + 1, text: line }] : []);
          return hits.length > 0 ? hits : undefined;
        },
      });
      return matches.flatMap((entry: Array<{ path: string; line: number; text: string }> | undefined) => entry ?? []);
    }),
    defineRepoTool("repo_stat", "Stat repository file", Type.Object({ path: Type.String(), ref: Type.Optional(Type.String()) }), async (params) => {
      const oid = await resolveGitRef(remote.gitdir, params.ref ?? remote.headRef);
      const blob = await git.readBlob({ fs, gitdir: remote.gitdir, oid, filepath: params.path });
      return { path: params.path, oid: blob.oid, size: blob.blob.byteLength };
    }),
  ];
}

function defineRepoTool<TParams extends ReturnType<typeof Type.Object>>(name: string, description: string, parameters: TParams, run: (params: import("@sinclair/typebox").Static<TParams>) => Promise<unknown>): ToolDefinition {
  return defineTool({
    name,
    label: name,
    description,
    parameters,
    async execute(_toolCallId, params) {
      const result = await Result.tryPromise({ try: () => run(params as import("@sinclair/typebox").Static<TParams>), catch: (cause) => cause });
      if (result.isErr()) {
        throw result.error;
      }
      const value = result.value;
      return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: value };
    },
  });
}

async function resolveGitRef(gitdir: string, ref: string): Promise<string> {
  return git.resolveRef({ fs, gitdir, ref });
}

function normalizeRepoPath(path: string | undefined): string {
  if (!path || path === "/") {
    return "";
  }
  return path.replace(/^\/+/, "");
}
