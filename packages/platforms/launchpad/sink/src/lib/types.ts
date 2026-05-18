import type { Static } from "@code-review-harness/core";
import type { LaunchpadApi } from "@code-review-harness/launchpad-sdk";
import type { LaunchpadReview } from "./LaunchpadReview.js";

export type LaunchpadReviewPayload = Static<typeof LaunchpadReview>;

export interface LaunchpadSinkOptions {
  api?: LaunchpadApi;
  url: string;
  accessToken?: string;
  accessSecret?: string;
  consumerKey?: string;
}
