import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

const terminalRenderer = markedTerminal({
  reflowText: false,
  showSectionPrefix: false,
}) as unknown as MarkedExtension;

const renderer = new Marked(terminalRenderer);

export function renderMarkdown(md: string): string {
  return renderer.parse(md, { async: false });
}
