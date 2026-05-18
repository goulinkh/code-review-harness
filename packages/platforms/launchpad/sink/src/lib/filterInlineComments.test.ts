import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { filterInlineComments } from "./filterInlineComments.js";

describe("filterInlineComments", () => {
  it("keeps numbered content lines and drops ranges, headers, and out-of-range lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crh-inline-"));
    const path = join(dir, "numbered.diff");
    await writeFile(path, "     diff --git a/a b/a\n   2: +ok\n   3: -old\n");

    await expect(filterInlineComments({ "0": "zero", "1": "header", "2": "ok", "3": "old", "4": "blank", "5": "missing", "2-3": "range" }, path)).resolves.toEqual({ "2": "ok", "3": "old" });
  });
});
