import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { TSchema, Static } from "@sinclair/typebox";
import type { HttpClient } from "isomorphic-git";

export interface PRMetadata {
  url: string;
  title: string;
  body: string;
  author?: string;
  sourceGitPath?: string;
  sourceGitRepositoryLink?: string;
  targetGitPath?: string;
}

export interface PreviewDiff {
  id: number;
  createdAt: string;
  baseRev?: string;
  headRev?: string;
}

export interface GeneralComment {
  id?: string;
  author?: string;
  dateCreated?: string;
  subject?: string;
  content: string;
}

export interface InlineComment extends GeneralComment {
  line: number;
  previewDiffId: number;
}

export interface CIStatus {
  checks: Array<Record<string, unknown>>;
}

export interface RemoteGitContext {
  url: string;
  gitdir: string;
  http: HttpClient;
  headRef: string;
  baseRef: string;
}

export interface ReviewProvider {
  id: string;
  fetchMetadata(): Promise<PRMetadata>;
  listPreviewDiffs(): Promise<PreviewDiff[]>;
  fetchDiff(previewDiffId: number): Promise<string>;
  fetchCommentsForPreviewDiff(previewDiffId: number): Promise<{
    general: GeneralComment[];
    inline: Record<string, InlineComment[]>;
  }>;
  fetchCI(): Promise<CIStatus>;
  remoteGit(): RemoteGitContext;
}

export interface ReviewSink<S extends TSchema = TSchema> {
  id: string;
  schema: S;
  emit(review: Static<S>, ctx: { provider: ReviewProvider; workspace: string }): Promise<void>;
}

export interface PreparedWorkspace {
  root: string;
  latestPreviewDiffId: number | undefined;
}

export interface PrepareWorkspaceOptions {
  root: string;
  onProgress?: (message: string) => void;
}

export interface LineMapEntry {
  side: "before" | "after" | "context";
  fileLine: number;
}

export interface FilePatch {
  safePath: string;
  path: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  patch: string;
  lineMap: Record<string, LineMapEntry>;
}

export interface CreateReviewSessionOptions {
  provider: ReviewProvider;
  sink: ReviewSink;
  workspace?: string;
  gitdir?: string;
  model?: Model<any>;
  systemPrompt?: string;
  subAgentSystemPrompt?: string;
  workspaceProgress?: (message: string) => void;
  onChildEvent?: (event: AgentSessionEvent, ctx: DelegateChildContext) => void;
}

export interface DelegateChildContext {
  slot: number;
  scope: string;
  focus?: string;
}

export interface ReviewSessionHandle {
  session: AgentSession;
  workspace: string;
  gitdir: string;
  changedFilesCount: number;
}

export interface SandboxProfileOptions {
  gitdir: string;
  workspace: string;
  modelApiHost?: string;
}
