import { describe, expect, it } from "vitest";
import { apiLPtoCodeLP, codeLPtoAPILP, convertCamelToSnake, convertSnakeToCamel, extractBranchNameFromGitPath, joinURL, previewDiffLinkToId } from "./utils.js";

describe("joinURL", () => {
  it("joins URL parts without duplicate slashes", () => {
    expect(joinURL("https://api.launchpad.net/devel/", "/~u/", "+git", "r")).toBe("https://api.launchpad.net/devel/~u/+git/r");
    expect(joinURL()).toBe("");
  });
});

describe("codeLPtoAPILP", () => {
  it("converts code Launchpad URLs to API URLs", () => {
    expect(codeLPtoAPILP("https://code.launchpad.net/~u/+git/r/+merge/1")).toBe("https://api.launchpad.net/devel/~u/+git/r/+merge/1");
  });
});

describe("apiLPtoCodeLP", () => {
  it("converts API Launchpad URLs to code URLs", () => {
    expect(apiLPtoCodeLP("https://api.launchpad.net/devel/~u/+git/r/+merge/1")).toBe("https://code.launchpad.net/~u/+git/r/+merge/1");
  });
});

describe("extractBranchNameFromGitPath", () => {
  it("removes refs heads prefix", () => {
    expect(extractBranchNameFromGitPath("refs/heads/main")).toBe("main");
    expect(extractBranchNameFromGitPath("main")).toBe("main");
  });
});

describe("previewDiffLinkToId", () => {
  it("extracts preview diff ids", () => {
    expect(previewDiffLinkToId("https://api.launchpad.net/devel/~u/+git/r/+merge/1/+preview-diff/42")).toBe(42);
  });

  it("rejects links without ids", () => {
    expect(() => previewDiffLinkToId("https://api.launchpad.net/devel/no-id")).toThrow("Unable to parse preview diff id");
  });
});

describe("convertCamelToSnake", () => {
  it("converts object keys recursively", () => {
    expect(convertCamelToSnake({ queueStatus: "Merged", nestedItems: [{ selfLink: "x" }] })).toEqual({ queue_status: "Merged", nested_items: [{ self_link: "x" }] });
  });
});

describe("convertSnakeToCamel", () => {
  it("converts object keys recursively", () => {
    expect(convertSnakeToCamel({ queue_status: "Merged", nested_items: [{ self_link: "x" }] })).toEqual({ queueStatus: "Merged", nestedItems: [{ selfLink: "x" }] });
  });
});
