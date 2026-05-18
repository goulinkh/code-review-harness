import type { ReviewSink } from "@code-review-harness/core";
import { StdoutReview } from "./StdoutReview.js";
import type { StdoutReviewPayload } from "./types.js";

export class StdoutSink implements ReviewSink<typeof StdoutReview> {
  readonly id = "stdout";
  readonly schema = StdoutReview;

  /** @note Impure — writes serialized review payload to stdout. */
  async emit(review: StdoutReviewPayload): Promise<void> {
    process.stdout.write(`${JSON.stringify(review)}\n`);
  }
}
