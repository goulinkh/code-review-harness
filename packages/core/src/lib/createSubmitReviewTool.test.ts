import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { createSubmitReviewTool } from "./createSubmitReviewTool.js";
import type { ReviewProvider, ReviewSink } from "./types.js";

const provider = { id: "p" } as ReviewProvider;

describe("createSubmitReviewTool", () => {
  it("emits review through sink and terminates session", async () => {
    const schema = Type.Object({ summary: Type.String() });
    const emit = vi.fn<ReviewSink<typeof schema>["emit"]>();
    const sink: ReviewSink<typeof schema> = { id: "sink", schema, emit };
    const tool = createSubmitReviewTool(sink, { provider, workspace: "/workspace" });

    await expect(tool.execute("call", { summary: "ok" })).resolves.toMatchObject({ details: { sink: "sink" }, terminate: true });
    expect(emit).toHaveBeenCalledWith({ summary: "ok" }, { provider, workspace: "/workspace" });
  });
});
