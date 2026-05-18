import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPrTools } from "./createPrTools.js";

async function callTool(tools: ReturnType<typeof createPrTools>, name: string, params: Record<string, unknown> = {}) {
  const tool = tools.find((entry) => entry.name === name)!;
  return tool.execute("call", params);
}

describe("createPrTools", () => {
  it("reads prepared workspace files through navigator tools", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "crh-tools-"));
    const round = join(workspace, "preview-diffs", "2");
    await mkdir(join(round, "diff", "files", "src", "a.ts"), { recursive: true });
    await mkdir(join(round, "comments", "inline"), { recursive: true });
    await mkdir(join(workspace, "agent", "rules"), { recursive: true });
    await writeFile(join(workspace, "metadata.json"), '{"title":"T"}');
    await writeFile(join(workspace, "preview-diffs", "index.json"), '[{"id":2}]');
    await writeFile(join(round, "diff", "files", "src", "a.ts", "meta.json"), '{"path":"src/a.ts","status":"modified","additions":3,"deletions":1,"lineMap":{"1":{"before":1,"after":1}}}');
    await writeFile(join(round, "diff", "files", "src", "a.ts", "patch"), "+x");
    await writeFile(join(round, "diff", "numbered.diff"), "   1: +x\n   2: +y");
    await writeFile(join(round, "comments", "general.json"), '["g"]');
    await writeFile(join(round, "comments", "inline", "1.json"), '["i"]');
    await writeFile(join(workspace, "agent", "AGENTS.md"), "rules");
    await writeFile(join(workspace, "agent", "rules", "rule.md"), "rule");
    await symlink("2", join(workspace, "preview-diffs", "latest"), "dir");

    const tools = createPrTools(workspace);
    await expect(callTool(tools, "mp_metadata")).resolves.toMatchObject({ details: { title: "T" } });
    await expect(callTool(tools, "preview_diffs_list")).resolves.toMatchObject({ details: [{ id: 2 }] });
    await expect(callTool(tools, "diff_list_files")).resolves.toMatchObject({ details: [{ path: "src/a.ts", status: "modified", additions: 3, deletions: 1 }] });
    await expect(callTool(tools, "diff_list_files", { previewDiffId: 2 })).resolves.toMatchObject({ details: [{ path: "src/a.ts", status: "modified", additions: 3, deletions: 1 }] });
    const listed = (await callTool(tools, "diff_list_files")) as { details: Array<Record<string, unknown>> };
    expect(listed.details[0]).not.toHaveProperty("lineMap");
    await expect(callTool(tools, "diff_get_file", { path: "src/a.ts" })).resolves.toMatchObject({ details: { patch: "+x" } });
    await expect(callTool(tools, "diff_numbered", { start: 2, end: 2 })).resolves.toMatchObject({ details: "   2: +y" });
    await expect(callTool(tools, "diff_numbered")).resolves.toMatchObject({ details: "   1: +x\n   2: +y" });
    await expect(callTool(tools, "comments_general")).resolves.toMatchObject({ details: ["g"] });
    await expect(callTool(tools, "comments_inline", { line: 1 })).resolves.toMatchObject({ details: ["i"] });
    await expect(callTool(tools, "comments_inline")).resolves.toMatchObject({ details: { "1": ["i"] } });
    await expect(callTool(tools, "agent_files_list")).resolves.toMatchObject({ details: ["AGENTS.md", "rules/rule.md"] });
  });

  it("does not expose a deterministic batch planner — slicing is the orchestrator's job", () => {
    const tools = createPrTools("/tmp/x");
    expect(tools.find((tool) => tool.name === "diff_plan_batches")).toBeUndefined();
  });

  it("returns empty lists for missing optional directories", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "crh-tools-empty-"));
    await mkdir(join(workspace, "preview-diffs", "1", "diff"), { recursive: true });
    await mkdir(join(workspace, "preview-diffs", "1", "comments"), { recursive: true });
    await symlink("1", join(workspace, "preview-diffs", "latest"), "dir");
    const tools = createPrTools(workspace);
    await expect(callTool(tools, "diff_list_files")).resolves.toMatchObject({ details: [] });
    await expect(callTool(tools, "comments_inline")).resolves.toMatchObject({ details: {} });
    await expect(callTool(tools, "agent_files_list")).resolves.toMatchObject({ details: [] });
  });
});
