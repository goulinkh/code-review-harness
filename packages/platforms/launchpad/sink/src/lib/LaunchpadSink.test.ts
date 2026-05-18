import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { Result } from "better-result";
import { LaunchpadApiError } from "@code-review-harness/launchpad-sdk";
import { LaunchpadSink } from "./LaunchpadSink.js";

function createApi(results: Array<ReturnType<typeof Result.ok> | ReturnType<typeof Result.err>>) {
  return { postComment: vi.fn(async () => results.shift()!) };
}

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "crh-lp-sink-"));
  const diffDir = join(workspace, "preview-diffs", "7", "diff");
  await mkdir(diffDir, { recursive: true });
  await writeFile(join(diffDir, "numbered.diff"), "   1: +ok\n");
  return workspace;
}

describe("LaunchpadSink", () => {
  it("posts inline comments and summary comments", async () => {
    const api = createApi([Result.ok("inline"), Result.ok("summary")]);
    const workspace = await createWorkspace();
    const sink = new LaunchpadSink({ url: "https://code.launchpad.net/mp", api: api as never });

    await sink.emit({ previewDiffId: 7, summary: "Summary", verdict: "needs-work", comments: ["a", "b"], inline_comments: { "1": "ok", "2-3": "range" } }, { workspace });

    expect(api.postComment).toHaveBeenNthCalledWith(1, "https://code.launchpad.net/mp", "", undefined, { "1": "ok" }, 7);
    expect(api.postComment).toHaveBeenNthCalledWith(2, "https://code.launchpad.net/mp", "**Automated LLM Review** (verdict: **needs-work**)\n\nSummary\n\n**Specific comments:**\n- a\n- b", "Needs Fixing");
  });

  it("skips inline post when filtered comments are empty", async () => {
    const api = createApi([Result.ok("summary")]);
    const workspace = await createWorkspace();
    const sink = new LaunchpadSink({ url: "https://code.launchpad.net/mp", api: api as never });

    await sink.emit({ previewDiffId: 7, summary: "Summary", verdict: "approve", comments: [], inline_comments: { "2": "missing" } }, { workspace });

    expect(api.postComment).toHaveBeenCalledOnce();
    expect(api.postComment).toHaveBeenCalledWith("https://code.launchpad.net/mp", "**Automated LLM Review** (verdict: **approve**)\n\nSummary", "Approve");
  });

  it("throws API errors from inline and summary posts", async () => {
    const workspace = await createWorkspace();
    const error = new LaunchpadApiError({ status: 500, url: "u", body: "b", message: "boom" });

    await expect(new LaunchpadSink({ url: "u", api: createApi([Result.err(error)]) as never }).emit({ previewDiffId: 7, summary: "s", verdict: "abstain", comments: [], inline_comments: { "1": "ok" } }, { workspace })).rejects.toBe(error);
    await expect(new LaunchpadSink({ url: "u", api: createApi([Result.err(error)]) as never }).emit({ previewDiffId: 7, summary: "s", verdict: "abstain", comments: [], inline_comments: {} }, { workspace })).rejects.toBe(error);
  });
});
