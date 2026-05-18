import { describe, expect, it } from "vitest";
import { mapVerdictToVote } from "./mapVerdictToVote.js";

describe("mapVerdictToVote", () => {
  it("maps review verdicts to Launchpad votes", () => {
    expect(mapVerdictToVote("approve")).toBe("Approve");
    expect(mapVerdictToVote("needs-work")).toBe("Needs Fixing");
    expect(mapVerdictToVote("abstain")).toBe("Abstain");
  });
});
