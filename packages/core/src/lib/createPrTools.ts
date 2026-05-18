import { promises as fs } from "node:fs";
import { join, posix } from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createSafeDiffPath } from "./diff.js";

/**
 * Default group budgets — sub-agent context window assumed ≥250k tokens,
 * so we can pack many files per slice without overflowing.
 */
const DEFAULT_MAX_GROUP_LINES = 4000;
const DEFAULT_MAX_GROUP_FILES = 20;

interface FileMeta {
  path: string;
  additions?: number;
  deletions?: number;
}

interface PlannedBatch {
  module: string;
  files: string[];
  changedLines: number;
}

export function planReviewBatches(metas: FileMeta[], maxLines: number, maxFiles: number): PlannedBatch[] {
  const byModule = new Map<string, FileMeta[]>();
  for (const meta of metas) {
    const module = posix.dirname(meta.path) || ".";
    const bucket = byModule.get(module) ?? [];
    bucket.push(meta);
    byModule.set(module, bucket);
  }
  const batches: PlannedBatch[] = [];
  for (const module of [...byModule.keys()].sort()) {
    const files = byModule.get(module)!;
    let current: PlannedBatch = { module, files: [], changedLines: 0 };
    for (const meta of files) {
      const size = (meta.additions ?? 0) + (meta.deletions ?? 0);
      const wouldOverflow = current.files.length > 0 && (current.changedLines + size > maxLines || current.files.length >= maxFiles);
      if (wouldOverflow) {
        batches.push(current);
        current = { module, files: [], changedLines: 0 };
      }
      current.files.push(meta.path);
      current.changedLines += size;
    }
    if (current.files.length > 0) batches.push(current);
  }
  return batches;
}

/** @note Impure — creates tools whose executions read prepared workspace files. */
export function createPrTools(workspace: string): ToolDefinition[] {
  return [
    defineJsonTool("mp_metadata", "Read merge proposal metadata", Type.Object({}), async () => readJson(join(workspace, "metadata.json"))),
    defineJsonTool("preview_diffs_list", "List preview diff rounds", Type.Object({}), async () => readJson(join(workspace, "preview-diffs", "index.json"))),
    defineJsonTool("diff_list_files", "List files changed in preview diff. Returns compact summaries (path, status, additions, deletions) — call diff_get_file for the patch + line map of a specific file.", Type.Object({ previewDiffId: Type.Optional(Type.Number()) }), async (params) => {
      const root = await resolvePreviewDiffRoot(workspace, params.previewDiffId);
      const filesRoot = join(root, "diff", "files");
      const files = await listFiles(filesRoot);
      const metas = await Promise.all(files.filter((file) => file.endsWith("/meta.json")).sort().map((file) => readJson(join(filesRoot, file)) as Promise<FileMeta & { status?: string; lineMap?: unknown }>));
      return metas.map((meta) => ({ path: meta.path, status: meta.status, additions: meta.additions ?? 0, deletions: meta.deletions ?? 0 }));
    }),
    defineJsonTool("diff_get_file", "Read one changed file patch and metadata", Type.Object({ path: Type.String(), previewDiffId: Type.Optional(Type.Number()) }), async (params) => {
      const root = await resolvePreviewDiffRoot(workspace, params.previewDiffId);
      const safePath = createSafeDiffPath(params.path);
      return {
        meta: await readJson(join(root, "diff", "files", safePath, "meta.json")),
        patch: await fs.readFile(join(root, "diff", "files", safePath, "patch"), "utf8"),
      };
    }),
    defineJsonTool("diff_numbered", "Read numbered diff range", Type.Object({ start: Type.Optional(Type.Number()), end: Type.Optional(Type.Number()), previewDiffId: Type.Optional(Type.Number()) }), async (params) => {
      const root = await resolvePreviewDiffRoot(workspace, params.previewDiffId);
      const lines = (await fs.readFile(join(root, "diff", "numbered.diff"), "utf8")).split("\n");
      const start = Math.max(1, params.start ?? 1);
      const end = Math.min(lines.length, params.end ?? lines.length);
      return lines.slice(start - 1, end).join("\n");
    }),
    defineJsonTool("comments_general", "Read general comments for preview diff", Type.Object({ previewDiffId: Type.Optional(Type.Number()) }), async (params) => {
      const root = await resolvePreviewDiffRoot(workspace, params.previewDiffId);
      return readJson(join(root, "comments", "general.json"));
    }),
    defineJsonTool("comments_inline", "Read inline comments for preview diff", Type.Object({ previewDiffId: Type.Optional(Type.Number()), line: Type.Optional(Type.Number()) }), async (params) => {
      const root = await resolvePreviewDiffRoot(workspace, params.previewDiffId);
      const inlineRoot = join(root, "comments", "inline");
      if (params.line !== undefined) {
        return readJson(join(inlineRoot, `${params.line}.json`));
      }
      const files = await fs.readdir(inlineRoot).catch(() => []);
      return Object.fromEntries(await Promise.all(files.sort().map(async (file) => [file.replace(/\.json$/, ""), await readJson(join(inlineRoot, file))])));
    }),
    defineJsonTool("agent_files_list", "List materialized agent instruction files", Type.Object({}), async () => listFiles(join(workspace, "agent"))),
    defineJsonTool(
      "diff_plan_batches",
      "Group changed files into review batches by parent folder and changed-line budget. Feed the resulting batches straight into delegate_review.scopes.",
      Type.Object({
        previewDiffId: Type.Optional(Type.Number()),
        maxLines: Type.Optional(Type.Number({ description: `Max additions+deletions per batch. Default ${DEFAULT_MAX_GROUP_LINES}.` })),
        maxFiles: Type.Optional(Type.Number({ description: `Max files per batch. Default ${DEFAULT_MAX_GROUP_FILES}.` })),
      }),
      async (params) => {
        const root = await resolvePreviewDiffRoot(workspace, params.previewDiffId);
        const filesRoot = join(root, "diff", "files");
        const entries = await listFiles(filesRoot);
        const metas: FileMeta[] = await Promise.all(
          entries.filter((file) => file.endsWith("/meta.json")).sort().map((file) => readJson(join(filesRoot, file)) as Promise<FileMeta>),
        );
        const maxLines = params.maxLines ?? DEFAULT_MAX_GROUP_LINES;
        const maxFiles = params.maxFiles ?? DEFAULT_MAX_GROUP_FILES;
        const batches = planReviewBatches(metas, maxLines, maxFiles);
        return {
          batches,
          scopes: batches.map((batch) => ({
            scope: `module: ${batch.module} (files: ${batch.files.join(", ")})`,
          })),
          totals: { files: metas.length, batches: batches.length, maxLines, maxFiles },
        };
      },
    ),
  ];
}

function defineJsonTool<TParams extends ReturnType<typeof Type.Object>>(name: string, description: string, parameters: TParams, run: (params: import("@sinclair/typebox").Static<TParams>) => Promise<unknown>): ToolDefinition {
  return defineTool({
    name,
    label: name,
    description,
    parameters,
    async execute(_toolCallId, params) {
      const value = await run(params as import("@sinclair/typebox").Static<TParams>);
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return { content: [{ type: "text", text }], details: value };
    },
  });
}

async function resolvePreviewDiffRoot(workspace: string, previewDiffId: number | undefined): Promise<string> {
  if (previewDiffId !== undefined) {
    return join(workspace, "preview-diffs", String(previewDiffId));
  }
  const latest = await fs.readlink(join(workspace, "preview-diffs", "latest"));
  return join(workspace, "preview-diffs", latest);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), relative);
      } else {
        result.push(relative);
      }
    }
  }
  await walk(root, "");
  return result;
}
