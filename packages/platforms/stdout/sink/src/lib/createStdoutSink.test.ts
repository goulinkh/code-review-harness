import { describe, expect, it } from "vitest";
import { StdoutSink } from "./StdoutSink.js";
import { createStdoutSink } from "./createStdoutSink.js";

describe("createStdoutSink", () => {
  it("creates stdout sink", () => {
    expect(createStdoutSink()).toBeInstanceOf(StdoutSink);
  });
});
