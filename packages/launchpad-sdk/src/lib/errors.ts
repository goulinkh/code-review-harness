import { TaggedError } from "better-result";

export class LaunchpadApiError extends TaggedError("LaunchpadApiError")<{
  status: number;
  url: string;
  body: string;
  message: string;
}>() {}

export class LaunchpadConfigError extends TaggedError("LaunchpadConfigError")<{
  message: string;
}>() {}
