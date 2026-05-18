import { describe, expect, it } from "vitest";
import { defaultReviewerPrompt } from "./defaultReviewerPrompt.js";

describe("defaultReviewerPrompt", () => {
  it("orients the reviewer toward custom tools", () => {
    expect(defaultReviewerPrompt).toEqual(expect.stringContaining("mp_metadata"));
    expect(defaultReviewerPrompt).toEqual(expect.stringContaining("preview_diffs_list"));
    expect(defaultReviewerPrompt).toEqual(expect.stringContaining("diff_list_files"));
    expect(defaultReviewerPrompt).toEqual(expect.stringContaining("diff_numbered"));
    expect(defaultReviewerPrompt).toEqual(expect.stringContaining("submit_review"));
    expect(defaultReviewerPrompt).toEqual(expect.stringContaining("diff_plan_batches"));
    expect(defaultReviewerPrompt).not.toMatch(/\bread\s+mp_metadata\b/i);
  });
});
