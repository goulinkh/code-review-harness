#!/usr/bin/env node

import { runCli } from "./commands/index.js";

await runCli(process.argv);
