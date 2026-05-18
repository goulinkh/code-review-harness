/**
 * Typed Launchpad REST API client.
 *
 * Extends `LaunchpadApiBase` with named methods for every LP endpoint used by
 * CRH. Each method returns `Promise<Result<T, LaunchpadApiError>>`; callers
 * branch on `isOk`/`isErr` at the SDK boundary — no try/catch required for
 * expected HTTP, network, or parse failures.
 */
import { Result } from "better-result";
import { LaunchpadApiBase } from "./LaunchpadApiBase.js";
import type { LaunchpadApiBaseOptions } from "./types.js";
import { LaunchpadApiError } from "./errors.js";
import { apiLPtoCodeLP, codeLPtoAPILP, extractBranchNameFromGitPath, joinURL, previewDiffLinkToId } from "./utils.js";
import type { Collection, Comment, DraftInlineComment, GitRef, InlineComment, MergeCriteria, MergeProposal, MergeProposalMergePayload, Person, PreviewDiff, Project, RevisionStatusReport } from "./types.js";

export class LaunchpadApi extends LaunchpadApiBase {
  constructor(options: LaunchpadApiBaseOptions) {
    super(options);
  }

  /** @note Impure — performs Launchpad API network I/O. */
  me(): Promise<Result<Person, LaunchpadApiError>> {
    return this.json<Person>("/people/+me", { name: "me" });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  async getMergeProposal(url: string): Promise<Result<MergeProposal, LaunchpadApiError>> {
    const result = await this.json<Omit<MergeProposal, "parsed">>(url, { name: "merge proposal" });
    if (result.isErr()) return result;
    return Result.ok({ ...result.value, parsed: parseMergeProposal(url, result.value) });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  getPreviewDiffs(url: string): Promise<Result<Collection<PreviewDiff>, LaunchpadApiError>> {
    return this.json<Collection<PreviewDiff>>(joinURL(url, "preview_diffs"), { convertFields: false, name: "preview diffs" });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  getDiffFiles(url: string, previewDiffId: number): Promise<Result<PreviewDiff, LaunchpadApiError>> {
    return this.json<PreviewDiff>(joinURL(apiLPtoCodeLP(url), "+preview-diff", String(previewDiffId)), { convertFields: false, name: "diff files" });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  async getDiffContent(diffTextLink: string): Promise<Result<string, LaunchpadApiError>> {
    const result = await this.text(diffTextLink);
    if (result.isErr()) return result;
    if (!result.value.startsWith("diff --git")) {
      return Result.err(
        new LaunchpadApiError({
          status: 200,
          url: diffTextLink,
          body: result.value.slice(0, 100),
          message: "Launchpad diff response did not start with diff --git",
        }),
      );
    }
    return result;
  }

  /** @note Impure — performs Launchpad API network I/O. */
  async getComments(url: string): Promise<Result<Comment[], LaunchpadApiError>> {
    const result = await this.json<Collection<Comment>>(joinURL(url, "all_comments"), { name: "comments" });
    if (result.isErr()) return result;
    return Result.ok(result.value.entries ?? []);
  }

  /** @note Impure — performs Launchpad API network I/O. */
  async getInlineComments(url: string, previewDiffLink: string): Promise<Result<InlineComment[], LaunchpadApiError>> {
    const previewDiffId = previewDiffLinkToId(previewDiffLink);
    const result = await this.json<Collection<InlineComment> | InlineComment[]>(url, {
      name: "inline comments",
      params: { "ws.op": "getInlineComments", previewdiff_id: String(previewDiffId) },
    });
    if (result.isErr()) return result;
    const rawEntries = Array.isArray(result.value) ? result.value : result.value.entries ?? [];
    const entries = rawEntries.map((comment) => {
      const lineNumber = Number(comment.lineNumber ?? comment.line_number ?? 0);
      const date = comment.dateCreated ?? comment.date_created ?? comment.date ?? "";
      return { ...comment, id: `${lineNumber}-${new Date(date).getTime()}`, lineNumber, dateCreated: date, previewdiffLink: previewDiffLink };
    });
    return Result.ok(entries);
  }

  /** @note Impure — performs Launchpad API network I/O. */
  async postComment(
    url: string,
    content = "",
    vote?: string,
    inlineComments?: Record<string, string>,
    previewDiffId?: number,
  ): Promise<Result<string, LaunchpadApiError>> {
    const body = new URLSearchParams();
    body.set("ws.op", "createComment");
    const subject = inlineComments && Object.keys(inlineComments).length > 0 ? "LLM Review: inline comments" : undefined;
    if (subject) body.set("subject", subject);
    body.set("content", content);
    if (vote) body.set("vote", vote);
    if (inlineComments) body.set("inline_comments", JSON.stringify(inlineComments));
    if (previewDiffId !== undefined) body.set("previewdiff_id", String(previewDiffId));
    const responseResult = await this.request(codeLPtoAPILP(url), { method: "POST", body });
    if (responseResult.isErr()) return responseResult;
    const response = responseResult.value;
    if (!response.ok) {
      const bodyText = await response.text();
      return Result.err(
        new LaunchpadApiError({
          status: response.status,
          url: response.url,
          body: bodyText.slice(0, 500),
          message: `Launchpad createComment failed: ${response.status}`,
        }),
      );
    }
    return Result.ok(response.headers.get("Location") ?? "");
  }

  /** @note Impure — performs Launchpad API network I/O. */
  getProject(name: string): Promise<Result<Project, LaunchpadApiError>> {
    return this.json<Project>(joinURL("/", name));
  }

  /** @note Impure — performs Launchpad API network I/O. */
  getMergeProposalVotes(url: string): Promise<Result<Collection<Record<string, unknown>>, LaunchpadApiError>> {
    return this.json<Collection<Record<string, unknown>>>(joinURL(url, "votes"));
  }

  /** @note Impure — performs Launchpad API network I/O. */
  isPersonTrustedReviewer(repoLink: string, personLink: string): Promise<Result<boolean, LaunchpadApiError>> {
    return this.json<boolean>(repoLink, { params: { "ws.op": "isPersonTrustedReviewer", reviewer: personLink } });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  canIMerge(url: string): Promise<Result<boolean, LaunchpadApiError>> {
    return this.json<boolean>(url, { params: { "ws.op": "canIMerge" } });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  async getMergeCriteria(url: string): Promise<Result<MergeCriteria, LaunchpadApiError>> {
    const result = await this.json<Record<string, unknown>>(url, { params: { "ws.op": "getMergeCriteria" } });
    if (result.isErr()) return result;
    return Result.ok({ ...result.value, optionalCriteria: result.value["optionalCriteria"] as Record<string, unknown> | undefined });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  merge(url: string, payload: MergeProposalMergePayload): Promise<Result<unknown, LaunchpadApiError>> {
    return this.json(url, { method: "POST", params: { "ws.op": "merge" }, body: payload });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  async getLatestStatusReports(repoLink: string, gitPath: string): Promise<Result<Collection<RevisionStatusReport>, LaunchpadApiError>> {
    const branch = extractBranchNameFromGitPath(gitPath);
    const refResult = await this.json<GitRef>(joinURL(repoLink, "+ref", branch));
    if (refResult.isErr() || !refResult.value.commitSha1) {
      return Result.ok({ entries: [] });
    }
    return this.json<Collection<RevisionStatusReport>>(repoLink, {
      params: { "ws.op": "getStatusReports", commit_sha1: refResult.value.commitSha1 },
    });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  updateMergeProposal(url: string, fields: Record<string, unknown>): Promise<Result<unknown, LaunchpadApiError>> {
    return this.json(url, { method: "PUT", body: fields });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  setMergeProposalStatus(url: string, fields: Record<string, unknown>): Promise<Result<unknown, LaunchpadApiError>> {
    const normalized = { ...fields, revid: fields["revid"] === null ? "" : fields["revid"] };
    return this.json(url, { method: "POST", params: { "ws.op": "setStatus" }, body: normalized });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  updateComment(commentUrl: string, newContent: string): Promise<Result<unknown, LaunchpadApiError>> {
    return this.json(commentUrl, { method: "POST", params: { "ws.op": "editContent", new_content: newContent } });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  deleteComment(commentUrl: string): Promise<Result<unknown, LaunchpadApiError>> {
    return this.json(commentUrl, { method: "POST", params: { "ws.op": "deleteContent" } });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  getDraftInlineComments(url: string, previewDiffLink: string): Promise<Result<Collection<DraftInlineComment>, LaunchpadApiError>> {
    return this.json<Collection<DraftInlineComment>>(url, {
      params: { "ws.op": "getDraftInlineComments", previewdiff_id: String(previewDiffLinkToId(previewDiffLink)) },
    });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  postDraftInlineComment(url: string, previewDiffId: number, comments: Record<string, string>): Promise<Result<unknown, LaunchpadApiError>> {
    return this.json(url, { method: "POST", params: { "ws.op": "saveDraftInlineComment", previewdiff_id: String(previewDiffId) }, body: { comments } });
  }

  /** @note Impure — performs Launchpad API network I/O. */
  searchPersons(query: string): Promise<Result<Collection<Person>, LaunchpadApiError>> {
    return this.json<Collection<Person>>("/people", { params: { "ws.op": "findPerson", text: query } });
  }
}

function parseMergeProposal(url: string, mp: Omit<MergeProposal, "parsed">): MergeProposal["parsed"] {
  const id = Number(url.match(/\/+merge\/(\d+)\/?$/)?.[1] ?? 0);
  return {
    id,
    sourceBranch: mp.sourceGitPath ?? mp.source_git_path,
    targetBranch: mp.targetGitPath ?? mp.target_git_path,
  };
}
