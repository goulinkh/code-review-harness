import { StdoutSink } from "./StdoutSink.js";

export function createStdoutSink(): StdoutSink {
  return new StdoutSink();
}
