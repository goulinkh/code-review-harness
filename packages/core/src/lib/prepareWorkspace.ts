/**
 * Workspace materialization for a review session.
 *
 * `prepareWorkspace` performs a single deterministic network burst (fetch
 * metadata, CI, preview-diff rounds, diffs, comments, agent files from git)
 * and writes the full workspace tree to disk before the agent starts. Re-runs
 * on the same input produce a byte-identical tree.
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { Result } from "better-result";
import { buildNumberedDiff, parseFilePatches } from "./diff.js";
import { stableJson } from "./stableJson.js";
import { WorkspaceError } from "./errors.js";
import type { PreparedWorkspace, PrepareWorkspaceOptions, PreviewDiff, ReviewProvider } from "./types.js";

/**
 * @note Impure — performs network I/O via the provider and writes the full workspace tree to disk.
 */
export async function prepareWorkspace(provider: ReviewProvider, options: PrepareWorkspaceOptions): Promise<PreparedWorkspace> {
  const root = options.root;
  const log = options.onProgress ?? (() => {});
  await fs.mkdir(root, { recursive: true });

  log("Fetching PR metadata, CI status, and diff list...");
  const [metadata, ci, rounds] = await Promise.all([
    provider.fetchMetadata(),
    provider.fetchCI(),
    provider.listPreviewDiffs(),
  ]);
  const sortedRounds = [...rounds].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id);
  const latestPreviewDiffId = sortedRounds.at(-1)?.id;

  log(`Writing workspace files (${sortedRounds.length} diff round(s))...`);
  await Promise.all([
    writeFile(join(root, "metadata.json"), stableJson(metadata)),
    writeFile(join(root, "description.md"), `# ${metadata.title}\n\n${metadata.body}\n`),
    writeFile(join(root, "ci.json"), stableJson(ci)),
    materializeAgentFiles(provider, root, log),
  ]);

  const previewRoot = join(root, "preview-diffs");
  await fs.mkdir(previewRoot, { recursive: true });
  await writeFile(
    join(previewRoot, "index.json"),
    stableJson(sortedRounds.map((round) => ({ ...round, isLatest: round.id === latestPreviewDiffId }))),
  );

  for (const round of sortedRounds) {
    log(`Fetching diff for round ${round.id}...`);
    await writePreviewDiff(provider, previewRoot, round);
  }

  if (latestPreviewDiffId !== undefined) {
    const latest = join(previewRoot, "latest");
    await fs.rm(latest, { force: true, recursive: true });
    await fs.symlink(String(latestPreviewDiffId), latest, "dir");
  }

  return { root, latestPreviewDiffId };
}

/**
 * @note Impure — fetches diff and comments via provider (network) and writes per-round files to disk.
 */
async function writePreviewDiff(provider: ReviewProvider, previewRoot: string, round: PreviewDiff): Promise<void> {
  const roundRoot = join(previewRoot, String(round.id));
  const diffRoot = join(roundRoot, "diff");
  const commentsRoot = join(roundRoot, "comments");
  await fs.mkdir(join(diffRoot, "files"), { recursive: true });
  await fs.mkdir(join(commentsRoot, "inline"), { recursive: true });

  const [rawDiff, comments] = await Promise.all([
    provider.fetchDiff(round.id),
    provider.fetchCommentsForPreviewDiff(round.id),
  ]);
  const files = parseFilePatches(rawDiff);

  await Promise.all([
    writeFile(join(roundRoot, "meta.json"), stableJson(round)),
    writeFile(join(diffRoot, "raw.diff"), rawDiff.endsWith("\n") ? rawDiff : `${rawDiff}\n`),
    writeFile(join(diffRoot, "numbered.diff"), `${buildNumberedDiff(rawDiff)}\n`),
    writeFile(join(commentsRoot, "general.json"), stableJson(comments.general)),
  ]);

  for (const [line, inlineComments] of Object.entries(comments.inline).sort(([left], [right]) => Number(left) - Number(right))) {
    await writeFile(join(commentsRoot, "inline", `${line}.json`), stableJson(inlineComments));
  }

  for (const file of files) {
    const fileRoot = join(diffRoot, "files", file.safePath);
    await fs.mkdir(fileRoot, { recursive: true });
    await Promise.all([
      writeFile(join(fileRoot, "patch"), `${file.patch}\n`),
      writeFile(join(fileRoot, "meta.json"), stableJson({
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        lineMap: file.lineMap,
      })),
    ]);
  }
}

/**
 * @note Impure — reads blobs from the git repo (network/FS via isomorphic-git) and writes agent files to disk.
 */
async function materializeAgentFiles(provider: ReviewProvider, workspace: string, log: (msg: string) => void): Promise<void> {
  const remote = provider.remoteGit();
  const agentRoot = join(workspace, "agent");
  await fs.mkdir(join(agentRoot, "rules"), { recursive: true });
  await fs.mkdir(join(agentRoot, "skills"), { recursive: true });

  await ensureGitObjects(remote, log);

  const contextFile = await findFirstExistingBlob(remote.gitdir, remote.headRef, ["AGENTS.md", "CLAUDE.md", ".cursorrules"]);
  if (contextFile) {
    await writeFile(join(agentRoot, "AGENTS.md"), contextFile);
  }

  for (const source of await listTreeFiles(remote.gitdir, remote.headRef, ".cursor/rules")) {
    if (source.endsWith(".md")) {
      const content = await readBlobText(remote.gitdir, remote.headRef, source);
      if (content !== undefined) {
        await writeFile(join(agentRoot, "rules", source.split("/").at(-1)!), content);
      }
    }
  }

  for (const source of await listTreeFiles(remote.gitdir, remote.headRef, ".clinerules")) {
    const content = await readBlobText(remote.gitdir, remote.headRef, source);
    if (content !== undefined) {
      await writeFile(join(agentRoot, "rules", source.split("/").at(-1)!), content);
    }
  }

  for (const source of await listTreeFiles(remote.gitdir, remote.headRef, ".crh/skills")) {
    if (source.endsWith(".md")) {
      const content = await readBlobText(remote.gitdir, remote.headRef, source);
      if (content !== undefined) {
        await writeFile(join(agentRoot, "skills", source.split("/").at(-1)!), content);
      }
    }
  }
}

/**
 * @note Impure — clones the remote git repo into `gitdir` if the head ref is not already present.
 */
async function ensureGitObjects(remote: ReturnType<ReviewProvider["remoteGit"]>, log: (msg: string) => void): Promise<void> {
  const hasHead = await Result.tryPromise({
    try: async () => git.resolveRef({ fs, gitdir: remote.gitdir, ref: remote.headRef }),
    catch: (cause) => new WorkspaceError({ path: remote.gitdir, message: "unable to resolve remote head ref", cause }),
  });
  if (hasHead.isOk()) {
    log("Git objects already cached.");
    return;
  }
  log(`Cloning repository ${remote.url}...`);
  await git.clone({
    fs,
    http: remote.http,
    dir: remote.gitdir,
    gitdir: remote.gitdir,
    url: remote.url,
    noCheckout: true,
    singleBranch: false,
    depth: 50,
  });
}

/** @note Impure — reads candidate blobs from the git object store. */
async function findFirstExistingBlob(gitdir: string, ref: string, paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    const content = await readBlobText(gitdir, ref, path);
    if (content !== undefined) {
      return content;
    }
  }
  return undefined;
}

/** @note Impure — resolves refs and reads blob bytes from the git object store. */
async function readBlobText(gitdir: string, ref: string, filepath: string): Promise<string | undefined> {
  const result = await Result.tryPromise({
    try: async () => {
      const oid = await git.resolveRef({ fs, gitdir, ref });
      const blob = await git.readBlob({ fs, gitdir, oid, filepath });
      return new TextDecoder().decode(blob.blob);
    },
    catch: () => undefined,
  });
  return result.unwrapOr(undefined);
}

/** @note Impure — walks git tree entries from the git object store. */
async function listTreeFiles(gitdir: string, ref: string, prefix: string): Promise<string[]> {
  const result = await Result.tryPromise({
    try: async () => {
      const oid = await git.resolveRef({ fs, gitdir, ref });
      const entries = await git.walk({
        fs,
        gitdir,
        trees: [git.TREE({ ref: oid })],
        map: async (filepath, [entry]) => {
          if (!entry || filepath === "." || !filepath.startsWith(`${prefix}/`)) {
            return undefined;
          }
          const type = await entry.type();
          return type === "blob" ? filepath : undefined;
        },
      });
      return entries.filter((entry: string | undefined): entry is string => entry !== undefined).sort();
    },
    catch: () => [] as string[],
  });
  return result.unwrapOr([]);
}

/** @note Impure — writes a file to the filesystem. */
async function writeFile(path: string, content: string): Promise<void> {
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, content);
}
