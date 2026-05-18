import { join } from "node:path";
import { LaunchpadApi } from "@code-review-harness/launchpad-sdk";
import type { ReviewSink } from "@code-review-harness/core";
import { LaunchpadReview } from "./LaunchpadReview.js";
import { filterInlineComments } from "./filterInlineComments.js";
import { mapVerdictToVote } from "./mapVerdictToVote.js";
import type { LaunchpadReviewPayload, LaunchpadSinkOptions } from "./types.js";

export class LaunchpadSink implements ReviewSink<typeof LaunchpadReview> {
  readonly id = "launchpad";
  readonly schema = LaunchpadReview;
  private readonly api: LaunchpadApi;
  private readonly url: string;

  /** @note Impure — reads environment-backed OAuth config when an API client is not provided. */
  constructor(options: LaunchpadSinkOptions) {
    this.url = options.url;
    this.api = options.api ?? new LaunchpadApi({
      accessToken: options.accessToken ?? process.env["LP_ACCESS_TOKEN"] ?? "",
      accessSecret: options.accessSecret ?? process.env["LP_ACCESS_SECRET"] ?? "",
      consumerKey: options.consumerKey ?? process.env["LP_CONSUMER_KEY"] ?? "crh",
    });
  }

  /** @note Impure — reads numbered diff from workspace and posts review comments to Launchpad. */
  async emit(review: LaunchpadReviewPayload, ctx: { workspace: string }): Promise<void> {
    const filtered = await filterInlineComments(review.inline_comments, join(ctx.workspace, "preview-diffs", String(review.previewDiffId), "diff", "numbered.diff"));
    if (Object.keys(filtered).length > 0) {
      const inlineResult = await this.api.postComment(this.url, "", undefined, filtered, review.previewDiffId);
      if (inlineResult.isErr()) throw inlineResult.error;
    }
    const summaryResult = await this.api.postComment(this.url, formatReviewBody(review), mapVerdictToVote(review.verdict));
    if (summaryResult.isErr()) throw summaryResult.error;
  }
}

function formatReviewBody(review: LaunchpadReviewPayload): string {
  const comments = review.comments.length > 0 ? `\n\n**Specific comments:**\n${review.comments.map((comment: string) => `- ${comment}`).join("\n")}` : "";
  return `**Automated LLM Review** (verdict: **${review.verdict}**)\n\n${review.summary}${comments}`;
}
