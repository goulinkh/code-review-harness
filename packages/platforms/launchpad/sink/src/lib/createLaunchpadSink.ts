import { LaunchpadSink } from "./LaunchpadSink.js";
import type { LaunchpadSinkOptions } from "./types.js";

/** @note Impure — constructs a sink that may read environment-backed OAuth config. */
export function createLaunchpadSink(options: LaunchpadSinkOptions): LaunchpadSink {
  return new LaunchpadSink(options);
}
