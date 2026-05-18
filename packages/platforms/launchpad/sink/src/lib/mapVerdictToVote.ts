import type { LaunchpadReviewPayload } from "./types.js";

export function mapVerdictToVote(verdict: LaunchpadReviewPayload["verdict"]): string {
  return verdict === "approve" ? "Approve" : verdict === "needs-work" ? "Needs Fixing" : "Abstain";
}
