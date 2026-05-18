# Code Review Harness

Code Review Harness (CRH) runs an AI code review session against a merge proposal, then emits the final review to a sink.

Current v1 support:

- Provider: Launchpad git merge proposals
- Sinks: stdout dry run, Launchpad comments
- Runtime: `@earendil-works/pi-coding-agent`
- Package manager: pnpm

## Install

```sh
pnpm install
pnpm -r build
```

## CLI usage

Dry-run review to stdout:

```sh
pnpm --filter @code-review-harness/cli exec crh review \
  --provider launchpad \
  --pr https://api.launchpad.net/devel/~user/+git/repo/+merge/123 \
  --sink stdout
```

Post review back to Launchpad:

```sh
LP_ACCESS_TOKEN=... \
LP_ACCESS_SECRET=... \
LP_CONSUMER_KEY=crh \
pnpm --filter @code-review-harness/cli exec crh review \
  --provider launchpad \
  --pr https://api.launchpad.net/devel/~user/+git/repo/+merge/123 \
  --sink launchpad
```

Useful flags:

- `--provider launchpad` — only supported provider in v1.
- `--pr <url>` — Launchpad API merge proposal URL. Bazaar MPs are rejected.
- `--sink stdout|launchpad` — defaults to `stdout`.
- `--model <provider:model>` — defaults to current CLI default.
- `--no-sandbox` — accepted by CLI; sandbox enforcement is still incomplete.
- `--config <path>` — accepted by CLI; config loading is still incomplete.

## Programmatic usage

```ts
import { createReviewSession } from "@code-review-harness/core";
import { createLaunchpadProvider } from "@code-review-harness/launchpad-provider";
import { createStdoutSink } from "@code-review-harness/stdout-sink";

const provider = createLaunchpadProvider({
  url: "https://api.launchpad.net/devel/~user/+git/repo/+merge/123",
});
const sink = createStdoutSink();
const { session } = await createReviewSession({ provider, sink });

session.subscribe((event) => process.stderr.write(`${JSON.stringify(event)}\n`));
await session.prompt("Review merge proposal. Submit final review with submit_review.");
```

See `examples/launchpad-mp.ts` for minimal example.

## Launchpad auth

Launchpad API calls use OAuth 1.0a HMAC-SHA1.

Set these when using Launchpad provider or sink against real Launchpad:

```sh
export LP_ACCESS_TOKEN=...
export LP_ACCESS_SECRET=...
export LP_CONSUMER_KEY=crh
```

`LP_CONSUMER_KEY` defaults to `crh` when omitted.

## Review outputs

`stdout` sink writes one JSON line to stdout.

`launchpad` sink posts:

1. Inline comments for valid `numbered.diff` line keys.
2. Summary comment with verdict vote:
   - `approve` → `Approve`
   - `needs-work` → `Needs Fixing`
   - `abstain` → `Abstain`

Inline keys must be single numbered-diff line numbers. Range keys and header-line keys are dropped.

## Workspace model

CRH prepares a deterministic workspace before the agent starts:

- `metadata.json`
- `description.md`
- `ci.json`
- `agent/` repo-provided instructions
- `preview-diffs/<id>/diff/numbered.diff`
- `preview-diffs/<id>/comments/`

Agent sessions get read-only built-ins plus CRH tools. Mutating built-ins (`bash`, `edit`, `write`) are not exposed.

## Development checks

```sh
pnpm -r typecheck
pnpm -r test
pnpm -r test:coverage
pnpm -r build
```

## Current limitations

- Launchpad git merge proposals only.
- No GitHub, Forgejo, local-git, or Bazaar provider in v1.
- Live Launchpad round-trip requires valid OAuth tokens and a sandbox MP.
- Sandbox profile exists, but full CLI sandbox lifecycle is not complete.
- Exact tool-surface acceptance gate and OAuth reference-vector test remain pending.
