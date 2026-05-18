import { LaunchpadProvider } from "./LaunchpadProvider.js";
import type { LaunchpadProviderOptions } from "./types.js";

/** @note Impure — constructs a provider that may read environment config or create a temp git directory. */
export function createLaunchpadProvider(options: LaunchpadProviderOptions): LaunchpadProvider {
  return new LaunchpadProvider(options);
}
