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
    defineRepoTool(
      "repo_read",
      "Read repository file. Paginate large files via startLine/endLine (1-based, inclusive). Default cap 2000 lines; response reports totalLines + truncated.",
      Type.Object({
        path: Type.String(),
        ref: Type.Optional(Type.String()),
        startLine: Type.Optional(Type.Integer({ minimum: 1 })),
        endLine: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
      async (params) => {
        const oid = await resolveGitRef(remote.gitdir, params.ref ?? remote.headRef);
        const blob = await git.readBlob({ fs, gitdir: remote.gitdir, oid, filepath: params.path });
        const text = new TextDecoder().decode(blob.blob);
        const lines = text.split("\n");
        const totalLines = lines.length;
        const start = Math.max(1, params.startLine ?? 1);
        const requestedEnd = params.endLine ?? start + READ_LINE_CAP - 1;
        const end = Math.min(totalLines, requestedEnd, start + READ_LINE_CAP - 1);
        const slice = lines.slice(start - 1, end);
        const truncated = end < totalLines || start > 1;
        return { path: params.path, startLine: start, endLine: end, totalLines, truncated, content: slice.join("\n") };
      },
    ),
    defineRepoTool(
      "repo_grep",
      "Search repository blobs with regex. pathGlob is a path substring (prefix-style) used to prune the walk; matches capped (truncated flag set when exceeded). Binary blobs skipped.",
      Type.Object({ pattern: Type.String(), pathGlob: Type.Optional(Type.String()), ref: Type.Optional(Type.String()), maxMatches: Type.Optional(Type.Integer({ minimum: 1 })) }),
      async (params) => {
        const regex = new RegExp(params.pattern);
        const oid = await resolveGitRef(remote.gitdir, params.ref ?? remote.headRef);
        const cap = params.maxMatches ?? GREP_MATCH_CAP;
        const hits: Array<{ path: string; line: number; text: string }> = [];
        let truncated = false;
        await git.walk({
          fs,
          gitdir: remote.gitdir,
          trees: [git.TREE({ ref: oid })],
          map: async (filepath, [entry]) => {
            if (!entry || filepath === ".") return undefined;
            if (hits.length >= cap) {
              truncated = true;
              return undefined;
            }
            const type = await entry.type();
            if (params.pathGlob && type === "tree" && !matchesPathPrefix(filepath, params.pathGlob)) {
              return null;
            }
            if (type !== "blob") return undefined;
            if (params.pathGlob && !filepath.includes(params.pathGlob)) return undefined;
            const blob = await entry.content();
            if (!blob || isBinaryBlob(blob)) return undefined;
            const text = new TextDecoder().decode(blob);
            const lines = text.split("\n");
            for (let index = 0; index < lines.length; index += 1) {
              if (hits.length >= cap) {
                truncated = true;
                break;
              }
              if (regex.test(lines[index])) {
                hits.push({ path: filepath, line: index + 1, text: lines[index] });
              }
            }
            return undefined;
          },
        });
        return { matches: hits, truncated, cap };
      },
    ),
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
  const candidates = buildRefCandidates(ref);
  for (const candidate of candidates) {
    const result = await Result.tryPromise({ try: () => git.resolveRef({ fs, gitdir, ref: candidate }), catch: (cause) => cause });
    if (result.isOk()) return result.value;
  }
  throw new Error(`Could not resolve ref ${ref} (tried: ${candidates.join(", ")})`);
}

function buildRefCandidates(ref: string): string[] {
  const stripped = ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, "");
  return [...new Set([ref, `refs/remotes/origin/${stripped}`, `refs/heads/${stripped}`, stripped])];
}

function normalizeRepoPath(path: string | undefined): string {
  if (!path || path === "/") {
    return "";
  }
  return path.replace(/^\/+/, "");
}

const READ_LINE_CAP = 2000;
const GREP_MATCH_CAP = 200;
const BINARY_SNIFF_BYTES = 8192;

function isBinaryBlob(blob: Uint8Array): boolean {
  const limit = Math.min(blob.byteLength, BINARY_SNIFF_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (blob[index] === 0) return true;
  }
  return false;
}

function matchesPathPrefix(filepath: string, pathGlob: string): boolean {
  if (filepath.includes(pathGlob)) return true;
  return pathGlob.startsWith(filepath) || pathGlob.startsWith(`${filepath}/`);
}
