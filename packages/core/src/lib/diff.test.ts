import { describe, expect, it } from "vitest";
import { buildNumberedDiff, createSafeDiffPath, parseFilePatches } from "./diff.js";

const rawDiff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 old
-remove
+add
`;

describe("buildNumberedDiff", () => {
  it("numbers content lines and indents headers", () => {
    expect(buildNumberedDiff(rawDiff).split("\n").slice(0, 8)).toEqual([
      "     diff --git a/src/a.ts b/src/a.ts",
      "     index 111..222 100644",
      "     --- a/src/a.ts",
      "     +++ b/src/a.ts",
      "     @@ -1,2 +1,2 @@",
      "   6:  old",
      "   7: -remove",
      "   8: +add",
    ]);
  });
});

describe("parseFilePatches", () => {
  it("extracts per-file metadata and line map", () => {
    expect(parseFilePatches(rawDiff)).toEqual([
      {
        safePath: "src/a.ts",
        path: "src/a.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "@@ -1,2 +1,2 @@\n old\n-remove\n+add",
        lineMap: {
          "6": { side: "context", fileLine: 1 },
          "7": { side: "before", fileLine: 2 },
          "8": { side: "after", fileLine: 2 },
          "9": { side: "context", fileLine: 3 },
        },
      },
    ]);
  });
});

describe("createSafeDiffPath", () => {
  it("preserves slash-separated paths", () => {
    expect(createSafeDiffPath("src/lib/a.ts")).toBe("src/lib/a.ts");
  });

  it("rejects path traversal", () => {
    expect(() => createSafeDiffPath("../secret")).toThrow("unsafe diff path");
  });

  it("handles added, deleted, and unknown paths", () => {
    const added = `diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n`;
    expect(parseFilePatches(added)[0]).toMatchObject({ path: "new.txt", status: "added" });

    const deleted = `diff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n`;
    expect(parseFilePatches(deleted)[0]).toMatchObject({ path: "old.txt", status: "deleted" });

    expect(parseFilePatches("diff --git x y\n@@ -1 +1 @@\n same\n")[0]).toMatchObject({ path: "unknown" });
  });
});
