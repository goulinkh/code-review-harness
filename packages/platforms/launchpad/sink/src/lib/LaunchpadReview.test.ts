import { describe, expect, it } from "vitest";
import { LaunchpadReview } from "./LaunchpadReview.js";

describe("LaunchpadReview", () => {
  it("defines expected schema fields", () => {
    expect(Object.keys(LaunchpadReview.properties)).toEqual(["previewDiffId", "summary", "verdict", "comments", "inline_comments"]);
  });
});
