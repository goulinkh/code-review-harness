import { Command } from "commander";
import { getModel, type Model } from "@earendil-works/pi-ai";
import { createReviewSession } from "@code-review-harness/core";
import { createLaunchpadProvider } from "@code-review-harness/launchpad-provider";
import { createLaunchpadSink } from "@code-review-harness/launchpad-sink";
import { createStdoutSink } from "@code-review-harness/stdout-sink";
import { formatSessionEvent } from "./formatSessionEvent.js";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function logProgress(message: string): void {
  log(`${DIM}[workspace]${RESET} ${message}`);
}

interface ReviewCommandOptions {
  provider: string;
  pr: string;
  sink: string;
  model: string;
  modelBaseUrl?: string;
  debug: boolean;
}

export function createReviewCommand(): Command {
  return new Command("review")
    .requiredOption("--provider <provider>", "review provider")
    .requiredOption("--pr <url>", "merge proposal URL")
    .option("--sink <sink>", "review sink", "stdout")
    .option("--model <model>", "model id", "anthropic:claude-sonnet-4-6")
    .option("--model-base-url <url>", "OpenAI-compatible model API base URL")
    .option("--no-sandbox", "disable sandbox")
    .option("--config <path>", "config path")
    .option("--debug", "dump all raw session events to stderr")
    .action(runReviewCommand);
}

/** @note Impure — creates provider/sink objects, starts agent session, and writes progress to stderr. */
async function runReviewCommand(options: ReviewCommandOptions): Promise<void> {
  if (options.provider !== "launchpad") {
    throw new Error(`Unsupported provider: ${options.provider}`);
  }

  log(`\n${BOLD}Code Review Harness${RESET}`);
  log(`${DIM}PR:    ${RESET}${options.pr}`);
  log(`${DIM}Model: ${RESET}${options.model}`);
  log(`${DIM}Sink:  ${RESET}${options.sink}`);
  log("");

  const provider = createLaunchpadProvider({ url: options.pr });
  const sink = options.sink === "launchpad" ? createLaunchpadSink({ url: options.pr }) : createStdoutSink();

  logProgress("Preparing workspace...");
  const { session } = await createReviewSession({
    provider,
    sink,
    model: parseModel(options.model, options.modelBaseUrl),
    workspaceProgress: logProgress,
    onChildEvent: (event, ctx) => {
      if (options.debug) {
        log(`${DIM}[debug sub:${ctx.slot}] ${JSON.stringify(event)}${RESET}`);
      }
      const line = formatSessionEvent(event, { kind: "sub", slot: ctx.slot, scope: ctx.scope });
      if (line !== undefined) {
        log(line);
      }
    },
  });
  logProgress("Workspace ready.\n");

  session.subscribe((event) => {
    if (options.debug) {
      log(`${DIM}[debug] ${JSON.stringify(event)}${RESET}`);
    }
    const line = formatSessionEvent(event, { kind: "main" });
    if (line !== undefined) {
      log(line);
    }
  });

  log(`${CYAN}Starting review...${RESET}\n`);
  await session.prompt("Review merge proposal. Submit final review with submit_review.");
  log(`\n${BOLD}Done.${RESET}`);
}

function parseModel(model: string, baseUrl?: string): Model<any> | undefined {
  const [provider, id] = model.split(":", 2);
  if (!provider || !id) {
    return undefined;
  }
  const registered = getModel(provider as never, id as never) as Model<any> | undefined;
  if (!baseUrl) {
    return registered;
  }
  if (!registered && provider !== "openai") {
    throw new Error("--model-base-url requires openai:<model> or a registered OpenAI-compatible model");
  }
  if (registered && !isOpenAICompatibleModel(registered)) {
    throw new Error("--model-base-url requires an OpenAI-compatible model");
  }
  return {
    ...(registered ?? createOpenAICompatibleModel(id)),
    api: registered?.api ?? "openai-completions",
    baseUrl,
  } as Model<any>;
}

function isOpenAICompatibleModel(model: Model<any>): boolean {
  return model.api === "openai-completions" || model.api === "openai-responses";
}

function createOpenAICompatibleModel(id: string): Model<any> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  } as Model<any>;
}
