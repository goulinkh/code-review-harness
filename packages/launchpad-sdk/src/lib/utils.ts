export function joinURL(...parts: string[]): string {
  const [first, ...rest] = parts.filter(Boolean);
  if (!first) return "";
  return [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].filter(Boolean).join("/");
}

export function codeLPtoAPILP(url: string): string {
  return url.replace("https://code.launchpad.net/", "https://api.launchpad.net/devel/");
}

export function apiLPtoCodeLP(url: string): string {
  return url.replace("https://api.launchpad.net/devel/", "https://code.launchpad.net/");
}

export function extractBranchNameFromGitPath(gitPath: string): string {
  return gitPath.replace(/^refs\/heads\//, "");
}

export function previewDiffLinkToId(link: string): number {
  const match = /(\d+)\/?$/.exec(link);
  if (!match) {
    throw new Error(`Unable to parse preview diff id from ${link}`);
  }
  return Number(match[1]);
}

export function convertSnakeToCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convertSnakeToCamel);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [snakeToCamel(key), convertSnakeToCamel(entry)]));
  }
  return value;
}

export function convertCamelToSnake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convertCamelToSnake);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [camelToSnake(key), convertCamelToSnake(entry)]));
  }
  return value;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}
