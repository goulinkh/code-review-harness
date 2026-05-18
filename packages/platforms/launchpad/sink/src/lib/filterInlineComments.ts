import { promises as fs } from "node:fs";

/** @note Impure — reads `numbered.diff` from the filesystem to validate line numbers. */
export async function filterInlineComments(comments: Record<string, string>, numberedDiffPath: string): Promise<Record<string, string>> {
  const lines = (await fs.readFile(numberedDiffPath, "utf8")).split("\n");
  return Object.fromEntries(Object.entries(comments).filter(([line]) => isValidInlineLine(line, lines)));
}

function isValidInlineLine(line: string, lines: string[]): boolean {
  if (!/^\d+$/.test(line)) return false;
  const index = Number(line) - 1;
  return index >= 0 && index < lines.length && /^\s*\d+: /.test(lines[index]);
}
