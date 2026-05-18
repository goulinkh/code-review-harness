import { describe, expect, it } from "vitest";
import { UnsupportedRepoTypeError } from "@code-review-harness/core";
import { LaunchpadProvider } from "./LaunchpadProvider.js";
import { createLaunchpadProvider } from "./createLaunchpadProvider.js";

describe("createLaunchpadProvider", () => {
  it("creates a Launchpad provider for git merge proposal URLs", () => {
    expect(createLaunchpadProvider({ url: "https://api.launchpad.net/devel/~u/+git/r/+merge/1", gitdir: "/tmp/git" })).toBeInstanceOf(LaunchpadProvider);
  });

  it("rejects non-git merge proposal URLs", () => {
    expect(() => createLaunchpadProvider({ url: "https://api.launchpad.net/devel/~u/+branch/r/+merge/1", gitdir: "/tmp/git" })).toThrow(UnsupportedRepoTypeError);
  });
});
