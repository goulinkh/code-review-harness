import type { LaunchpadApi } from "@code-review-harness/launchpad-sdk";

export interface LaunchpadProviderOptions {
  url: string;
  api?: LaunchpadApi;
  gitdir?: string;
  accessToken?: string;
  accessSecret?: string;
  consumerKey?: string;
}
