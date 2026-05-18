import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "isomorphic-git/http/node";
import { LaunchpadApi, apiLPtoCodeLP, previewDiffLinkToId, type Comment, type MergeProposal, type PreviewDiff as LaunchpadPreviewDiff } from "@code-review-harness/launchpad-sdk";
import { UnsupportedRepoTypeError, type CIStatus, type GeneralComment, type InlineComment, type PRMetadata, type PreviewDiff, type ReviewProvider } from "@code-review-harness/core";
import type { LaunchpadProviderOptions } from "./types.js";

export class LaunchpadProvider implements ReviewProvider {
  readonly id = "launchpad";
  private readonly api: LaunchpadApi;
  private readonly url: string;
  private readonly gitdir: string;
  private metadataCache?: MergeProposal;
  private commentsCache?: Comment[];
  private previewDiffsCache?: PreviewDiff[];

  /** @note Impure — reads environment-backed OAuth config and may create a temp git directory. */
  constructor(options: LaunchpadProviderOptions) {
    if (!isGitMergeProposalUrl(options.url)) {
      throw new UnsupportedRepoTypeError({ url: options.url, message: "Only Launchpad git merge proposal API URLs are supported" });
    }
    this.url = options.url;
    this.gitdir = options.gitdir ?? mkdtempSync(join(tmpdir(), "crh-launchpad-git-"));
    this.api = options.api ?? new LaunchpadApi({
      accessToken: options.accessToken ?? process.env["LP_ACCESS_TOKEN"] ?? "",
      accessSecret: options.accessSecret ?? process.env["LP_ACCESS_SECRET"] ?? "",
      consumerKey: options.consumerKey ?? process.env["LP_CONSUMER_KEY"] ?? "crh",
    });
  }

  /** @note Impure — fetches or reads cached Launchpad merge proposal metadata. */
  async fetchMetadata(): Promise<PRMetadata> {
    const mp = await this.getMergeProposal();
    return {
      url: this.url,
      title: mp.description ?? "Launchpad merge proposal",
      body: mp.commitMessage ?? mp.commit_message ?? "",
      author: mp.registrantLink ?? mp.registrant_link,
      sourceGitPath: mp.sourceGitPath ?? mp.source_git_path,
      sourceGitRepositoryLink: mp.sourceGitRepositoryLink ?? mp.source_git_repository_link,
      targetGitPath: mp.targetGitPath ?? mp.target_git_path,
    };
  }

  /** @note Impure — fetches or reads cached Launchpad preview-diff metadata. */
  async listPreviewDiffs(): Promise<PreviewDiff[]> {
    if (this.previewDiffsCache) return this.previewDiffsCache;
    const result = await this.api.getPreviewDiffs(this.url);
    if (result.isErr()) throw result.error;
    this.previewDiffsCache = (result.value.entries ?? [])
      .map((entry) => mapPreviewDiff(entry))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id);
    return this.previewDiffsCache;
  }

  /** @note Impure — fetches diff content from Launchpad and may use web fallback URL. */
  async fetchDiff(previewDiffId: number): Promise<string> {
    const diffFilesResult = await this.api.getDiffFiles(this.url, previewDiffId);
    if (diffFilesResult.isOk()) {
      const link = diffFilesResult.value.diffTextLink ?? diffFilesResult.value.diff_text_link;
      if (link) {
        const contentResult = await this.api.getDiffContent(link);
        if (contentResult.isOk()) return contentResult.value;
      }
    }
    const fallbackResult = await this.api.getDiffContent(`${apiLPtoCodeLP(this.url)}/+preview-diff/${previewDiffId}/+files/preview.diff`);
    if (fallbackResult.isErr()) throw fallbackResult.error;
    return fallbackResult.value;
  }

  /** @note Impure — fetches or reads cached Launchpad comments for a preview diff. */
  async fetchCommentsForPreviewDiff(previewDiffId: number): Promise<{ general: GeneralComment[]; inline: Record<string, InlineComment[]> }> {
    const [comments, rounds] = await Promise.all([this.getComments(), this.listPreviewDiffs()]);
    const round = rounds.find((entry) => entry.id === previewDiffId);
    const previewDiffLink = `${this.url}/+preview-diff/${previewDiffId}`;
    const inlineResult = await this.api.getInlineComments(this.url, previewDiffLink);
    if (inlineResult.isErr()) throw inlineResult.error;
    return {
      general: comments
        .filter((comment) => !comment.previewdiffLink && !comment.previewdiff_link)
        .filter((comment) => !round || !comment.dateCreated || comment.dateCreated >= round.createdAt)
        .map(mapGeneralComment),
      inline: groupInlineComments(inlineResult.value, previewDiffId),
    };
  }

  async fetchCI(): Promise<CIStatus> {
    return { checks: [] };
  }

  remoteGit() {
    return {
      url: `https://git.launchpad.net/${this.getSourceUniqueName()}`,
      gitdir: this.gitdir,
      http,
      headRef: this.metadataCache?.sourceGitPath ?? this.metadataCache?.source_git_path ?? "HEAD",
      baseRef: this.metadataCache?.targetGitPath ?? this.metadataCache?.target_git_path ?? "HEAD",
    };
  }

  /** @note Impure — fetches and caches Launchpad merge proposal metadata. */
  private async getMergeProposal(): Promise<MergeProposal> {
    if (!this.metadataCache) {
      const result = await this.api.getMergeProposal(this.url);
      if (result.isErr()) throw result.error;
      this.metadataCache = result.value;
    }
    return this.metadataCache;
  }

  /** @note Impure — fetches and caches Launchpad comments. */
  private async getComments(): Promise<Comment[]> {
    if (!this.commentsCache) {
      const result = await this.api.getComments(this.url);
      if (result.isErr()) throw result.error;
      this.commentsCache = result.value;
    }
    return this.commentsCache;
  }

  private getSourceUniqueName(): string {
    const link = this.metadataCache?.sourceGitRepositoryLink ?? this.metadataCache?.source_git_repository_link ?? "";
    return link.split("/+git/").length > 1 ? link.replace(/^.*\/devel\//, "") : "";
  }
}

function isGitMergeProposalUrl(url: string): boolean {
  return /^https:\/\/api\.launchpad\.net\/devel\/.+\/\+git\/.+\/\+merge\/\d+\/?$/.test(url);
}

function mapPreviewDiff(entry: LaunchpadPreviewDiff): PreviewDiff {
  const link = entry.self_link ?? entry.selfLink ?? "";
  return {
    id: entry.id ?? previewDiffLinkToId(link),
    createdAt: entry.date_created ?? entry.dateCreated ?? "",
    baseRev: entry.source_revision_id ?? entry.sourceRevisionId,
    headRev: entry.target_revision_id ?? entry.targetRevisionId,
  };
}

function mapGeneralComment(comment: Comment): GeneralComment {
  return {
    id: comment.selfLink ?? comment.self_link,
    author: comment.ownerLink ?? comment.owner_link,
    dateCreated: comment.dateCreated ?? comment.date_created,
    subject: comment.subject,
    content: comment.content ?? "",
  };
}

function groupInlineComments(comments: import("@code-review-harness/launchpad-sdk").InlineComment[], previewDiffId: number): Record<string, InlineComment[]> {
  const grouped: Record<string, InlineComment[]> = {};
  for (const comment of comments) {
    const line = String(comment.lineNumber ?? comment.line_number ?? 0);
    grouped[line] ??= [];
    grouped[line]!.push({
      id: comment.id,
      line: Number(line),
      previewDiffId,
      dateCreated: comment.dateCreated ?? comment.date_created,
      content: comment.text ?? comment.content ?? "",
    });
  }
  return grouped;
}
