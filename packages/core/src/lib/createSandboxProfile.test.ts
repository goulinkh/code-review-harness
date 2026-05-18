import { describe, expect, it } from "vitest";
import { createSandboxProfile } from "./createSandboxProfile.js";

describe("createSandboxProfile", () => {
  it("builds filesystem and network restrictions", () => {
    expect(createSandboxProfile({ gitdir: "/git", workspace: "/workspace", modelApiHost: "model.test" })).toEqual({
      filesystem: {
        allowWrite: ["/git", "/workspace"],
        denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", "**/.env*"],
      },
      network: {
        allowedDomains: ["api.launchpad.net", "code.launchpad.net", "git.launchpad.net", "model.test"],
      },
    });
    expect(createSandboxProfile({ gitdir: "/git", workspace: "/workspace" })).toMatchObject({
      network: { allowedDomains: ["api.launchpad.net", "code.launchpad.net", "git.launchpad.net", "api.anthropic.com"] },
    });
  });
});
