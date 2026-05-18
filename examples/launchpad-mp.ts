import { createReviewSession } from "@code-review-harness/core";
import { createLaunchpadProvider } from "@code-review-harness/launchpad-provider";
import { createStdoutSink } from "@code-review-harness/stdout-sink";

const provider = createLaunchpadProvider({ url: process.argv[2] ?? "" });
const sink = createStdoutSink();
const { session } = await createReviewSession({ provider, sink });
session.subscribe((event) => process.stderr.write(`${JSON.stringify(event)}\n`));
await session.prompt("Review merge proposal. Submit final review with submit_review.");
