import { promises as fs } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createSafeDiffPath } from "./diff.js";

interface FileMeta {
  path: string;
  additions?: number;
  deletions?: number;
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
      "diff_map_line",
      "Resolve a numbered-diff line number to its actual file line. Returns { path, side, fileLine } where side is 'before' (deleted), 'after' (added), or 'context'. Pass path to restrict lookup to one file; omit to search all changed files.",
      Type.Object({ diffLine: Type.Number(), path: Type.Optional(Type.String()), previewDiffId: Type.Optional(Type.Number()) }),
      async (params) => {
        const root = await resolvePreviewDiffRoot(workspace, params.previewDiffId);
        const filesRoot = join(root, "diff", "files");
        const key = String(params.diffLine);

        if (params.path !== undefined) {
          const safePath = createSafeDiffPath(params.path);
          const meta = (await readJson(join(filesRoot, safePath, "meta.json"))) as { lineMap?: Record<string, { side: string; fileLine: number }> };
          const entry = meta.lineMap?.[key];
          if (!entry) return { error: `diff line ${params.diffLine} not found in ${params.path}` };
          return { path: params.path, side: entry.side, fileLine: entry.fileLine };
        }

        const files = await listFiles(filesRoot);
        for (const file of files.filter((f) => f.endsWith("/meta.json"))) {
          const meta = (await readJson(join(filesRoot, file))) as { path?: string; lineMap?: Record<string, { side: string; fileLine: number }> };
          const entry = meta.lineMap?.[key];
          if (entry) return { path: meta.path, side: entry.side, fileLine: entry.fileLine };
        }
        return { error: `diff line ${params.diffLine} not found in any changed file` };
      },
    ),
    defineJsonTool(
      "mark_file_reviewed",
      "Record a changed file as reviewed. Call once per file after inspecting it. Drives the review progress percentage (reviewed / total changed files). `path` must match a path from diff_list_files.",
      Type.Object({ path: Type.String() }),
      async (params) => {
        const reviewedPath = join(workspace, "reviewed.json");
        let current: string[] = [];
        try {
          const raw = await fs.readFile(reviewedPath, "utf8");
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) current = parsed.filter((entry): entry is string => typeof entry === "string");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        const alreadyReviewed = current.includes(params.path);
        if (!alreadyReviewed) current.push(params.path);
        await fs.writeFile(reviewedPath, JSON.stringify(current));
        return { path: params.path, reviewedCount: current.length, alreadyReviewed };
      },
      "sequential",
    ),
  ];
}

function defineJsonTool<TParams extends ReturnType<typeof Type.Object>>(name: string, description: string, parameters: TParams, run: (params: import("@sinclair/typebox").Static<TParams>) => Promise<unknown>, executionMode?: "sequential" | "parallel"): ToolDefinition {
  return defineTool({
    name,
    label: name,
    description,
    parameters,
    ...(executionMode ? { executionMode } : {}),
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
