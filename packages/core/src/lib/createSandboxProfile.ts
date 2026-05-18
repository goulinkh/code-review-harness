import type { SandboxProfileOptions } from "./types.js";

export function createSandboxProfile(options: SandboxProfileOptions): Record<string, unknown> {
  return {
    filesystem: {
      allowWrite: [options.gitdir, options.workspace],
      denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", "**/.env*"],
    },
    network: {
      allowedDomains: [
        "api.launchpad.net",
        "code.launchpad.net",
        "git.launchpad.net",
        options.modelApiHost ?? "api.anthropic.com",
      ],
    },
  };
}
