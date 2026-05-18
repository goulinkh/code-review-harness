import { describe, expect, it } from "vitest";
import { LaunchpadSink } from "./LaunchpadSink.js";
import { createLaunchpadSink } from "./createLaunchpadSink.js";

describe("createLaunchpadSink", () => {
  it("creates Launchpad sink", () => {
    expect(createLaunchpadSink({ url: "u" })).toBeInstanceOf(LaunchpadSink);
  });
});
