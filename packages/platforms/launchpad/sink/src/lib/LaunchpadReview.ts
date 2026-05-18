import { Type } from "@code-review-harness/core";

export const LaunchpadReview = Type.Object({
  previewDiffId: Type.Number(),
  summary: Type.String(),
  verdict: Type.Union([Type.Literal("approve"), Type.Literal("needs-work"), Type.Literal("abstain")]),
  comments: Type.Array(Type.String()),
  inline_comments: Type.Record(Type.String(), Type.String()),
});
