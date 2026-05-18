import type { HeadersInit, RequestInit } from "undici";

export interface LaunchpadApiBaseOptions {
  accessToken: string;
  accessSecret: string;
  consumerKey?: string;
  consumerSecret?: string;
  serviceRoot?: string;
}

export interface LaunchpadRequestOptions extends Omit<RequestInit, "body" | "headers"> {
  params?: Record<string, string>;
  body?: unknown;
  headers?: HeadersInit;
}

export interface JsonRequestOptions extends LaunchpadRequestOptions {
  name?: string;
  convertFields?: boolean;
}

export interface Collection<T> {
  entries: T[];
  total_size?: number;
  totalSize?: number;
  next_collection_link?: string;
  nextCollectionLink?: string;
}

export interface Person {
  selfLink?: string;
  self_link?: string;
  displayName?: string;
  display_name?: string;
  name?: string;
}

export interface Project {
  selfLink?: string;
  name?: string;
  displayName?: string;
}

export interface MergeProposal {
  selfLink?: string;
  self_link?: string;
  webLink?: string;
  web_link?: string;
  description?: string;
  commitMessage?: string;
  commit_message?: string;
  registrantLink?: string;
  registrant_link?: string;
  sourceGitPath?: string;
  source_git_path?: string;
  sourceGitRepositoryLink?: string;
  source_git_repository_link?: string;
  targetGitPath?: string;
  target_git_path?: string;
  targetGitRepositoryLink?: string;
  target_git_repository_link?: string;
  parsed: {
    id: number;
    sourceBranch?: string;
    targetBranch?: string;
  };
}

export interface PreviewDiff {
  self_link?: string;
  selfLink?: string;
  id?: number;
  date_created?: string;
  dateCreated?: string;
  source_revision_id?: string;
  sourceRevisionId?: string;
  target_revision_id?: string;
  targetRevisionId?: string;
  diff_text_link?: string;
  diffTextLink?: string;
}

export interface Comment {
  self_link?: string;
  selfLink?: string;
  subject?: string;
  content?: string;
  date_created?: string;
  dateCreated?: string;
  owner_link?: string;
  ownerLink?: string;
  previewdiff_link?: string;
  previewdiffLink?: string;
}

export interface InlineComment {
  id: string;
  lineNumber: number;
  line_number?: number | string;
  text?: string;
  content?: string;
  date?: string;
  dateCreated?: string;
  date_created?: string;
  previewdiffLink?: string;
  previewdiff_link?: string;
}

export interface CommentPayload {
  subject?: string;
  content?: string;
  vote?: string;
  inline_comments?: Record<string, string>;
  previewdiff_id?: number;
}

export interface DraftInlineComment {
  lineNumber: number;
  text: string;
}

export interface GitRef {
  selfLink?: string;
  commitSha1?: string;
}

export interface MergeCriteria {
  isApproved?: boolean;
  ciChecksPassed?: boolean;
  optionalCriteria?: Record<string, unknown>;
}

export interface RawMergeCriteria extends Record<string, unknown> {}

export interface MergeProposalMergePayload extends Record<string, unknown> {}

export interface CodeReviewVoteReference extends Record<string, unknown> {}

export interface RevisionStatusReport extends Record<string, unknown> {}
