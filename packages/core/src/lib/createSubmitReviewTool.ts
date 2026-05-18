import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema, Static } from "@sinclair/typebox";
import type { ReviewProvider, ReviewSink } from "./types.js";

/** @note Impure — creates a tool whose execution emits review output through the active sink. */
export function createSubmitReviewTool<S extends TSchema>(sink: ReviewSink<S>, ctx: { provider: ReviewProvider; workspace: string }): ToolDefinition {
  return defineTool({
    name: "submit_review",
    label: "submit_review",
    description: "Submit final code review and end session",
    parameters: sink.schema,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      await sink.emit(params as Static<S>, ctx);
      return {
        content: [{ type: "text", text: "review submitted" }],
        details: { sink: sink.id },
        terminate: true,
      };
    },
  });
}
