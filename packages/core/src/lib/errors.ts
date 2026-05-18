/**
 * CRH domain errors.
 *
 * All errors extend `TaggedError` so callers can discriminate on `._tag`
 * without `instanceof` checks across package boundaries.
 */
import { TaggedError } from "better-result";

export class UnsupportedRepoTypeError extends TaggedError("UnsupportedRepoTypeError")<{
  url: string;
  message: string;
}>() {}

export class WorkspaceError extends TaggedError("WorkspaceError")<{
  path: string;
  message: string;
  cause?: unknown;
}>() {}

export class ToolInputError extends TaggedError("ToolInputError")<{
  message: string;
}>() {}
