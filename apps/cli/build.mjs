#!/usr/bin/env node
import { build } from "esbuild";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));

// Externalize anything declared as a runtime dependency; bundle the rest
// (which is just the @code-review-harness/* workspace packages).
const external = Object.keys(pkg.dependencies ?? {});

rmSync(resolve(here, "dist"), { recursive: true, force: true });

await build({
  entryPoints: [resolve(here, "src/index.ts")],
  outfile: resolve(here, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external,
  legalComments: "none",
  logLevel: "info",
});

chmodSync(resolve(here, "dist/index.js"), 0o755);
