import { afterEach, describe, expect, it, vi } from "vitest";
import { StdoutSink } from "./StdoutSink.js";

describe("StdoutSink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes review as one JSON line", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await new StdoutSink().emit({ verdict: "abstain" });
    expect(write).toHaveBeenCalledWith('{"verdict":"abstain"}\n');
  });
});
