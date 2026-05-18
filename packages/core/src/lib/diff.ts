import parseDiff from "parse-diff";
import type { FilePatch, LineMapEntry } from "./types.js";

export function buildNumberedDiff(rawDiff: string): string {
  const lines = rawDiff.split("\n");
  return lines
    .map((line, index) => {
      if (isDiffHeaderLine(line)) {
        return `     ${line}`;
      }
      return `${String(index + 1).padStart(4, " ")}: ${line}`;
    })
    .join("\n");
}

export function parseFilePatches(rawDiff: string): FilePatch[] {
  const parsed = parseDiff(rawDiff);
  const lineMaps = buildLineMaps(rawDiff);
  return parsed.map((file) => {
    /* v8 ignore next -- parse-diff supplies primary paths for parsed file entries. */
    const path = normalizeParsedPath(file.deleted ? file.from ?? file.to ?? "unknown" : file.to ?? file.from ?? "unknown");
    const status = file.new ? "added" : file.deleted ? "deleted" : "modified";
    const patch = file.chunks.map((chunk) => [chunk.content, ...chunk.changes.map((change) => change.content)].join("\n")).join("\n");
    return {
      safePath: createSafeDiffPath(path),
      path,
      status,
      additions: file.additions,
      deletions: file.deletions,
      patch,
      lineMap: lineMaps.get(path) ?? {},
    };
  });
}

export function createSafeDiffPath(path: string): string {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\"))) {
    throw new Error(`unsafe diff path: ${path}`);
  }
  return segments.join("/");
}

function isDiffHeaderLine(line: string): boolean {
  return line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@") || line.startsWith("\\");
}

function normalizeParsedPath(path: string): string {
  return path.replace(/^[ab]\//, "");
}

function buildLineMaps(rawDiff: string): Map<string, Record<string, LineMapEntry>> {
  const maps = new Map<string, Record<string, LineMapEntry>>();
  let currentPath: string | undefined;
  let beforeLine = 0;
  let afterLine = 0;

  for (const [index, line] of rawDiff.split("\n").entries()) {
    const lineNumber = String(index + 1);
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      if (!match) {
        currentPath = undefined;
        continue;
      }
      currentPath = match[2];
      if (!maps.has(currentPath)) {
        maps.set(currentPath, {});
      }
      continue;
    }
    if (!currentPath) {
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      beforeLine = Number(hunk[1]);
      afterLine = Number(hunk[2]);
      continue;
    }
    if (isDiffHeaderLine(line)) {
      continue;
    }
    const map = maps.get(currentPath)!;
    if (line.startsWith("+")) {
      map[lineNumber] = { side: "after", fileLine: afterLine };
      afterLine += 1;
    } else if (line.startsWith("-")) {
      map[lineNumber] = { side: "before", fileLine: beforeLine };
      beforeLine += 1;
    } else {
      map[lineNumber] = { side: "context", fileLine: afterLine };
      beforeLine += 1;
      afterLine += 1;
    }
  }
  return maps;
}
