import { describe, expect, it } from "vitest";
import { Result } from "better-result";
import { LaunchpadApi } from "./LaunchpadApi.js";
import { LaunchpadApiError, LaunchpadConfigError } from "./errors.js";
import type { JsonRequestOptions, LaunchpadRequestOptions } from "./types.js";

type Call = { kind: "json" | "text" | "request"; url: string; options?: unknown };

class TestApi extends LaunchpadApi {
  calls: Call[] = [];
  jsonQueue: Array<unknown> = [];
  textQueue: Array<unknown> = [];
  requestQueue: Array<unknown> = [];

  constructor() {
    super({ accessToken: "token", accessSecret: "secret" });
  }

  override json<T>(url: string, options: JsonRequestOptions = {}) {
    this.calls.push({ kind: "json", url, options });
    return Promise.resolve(this.jsonQueue.shift() as Result<T, LaunchpadApiError>);
  }

  override request(url: string, options: LaunchpadRequestOptions = {}) {
    this.calls.push({ kind: "request", url, options });
    return Promise.resolve(this.requestQueue.shift() as Result<Response, LaunchpadApiError>);
  }

  protected override text(url: string, options: JsonRequestOptions = {}) {
    this.calls.push({ kind: "text", url, options });
    return Promise.resolve(this.textQueue.shift() as Result<string, LaunchpadApiError>);
  }
}

function err(message = "boom") {
  return Result.err(new LaunchpadApiError({ status: 500, url: "u", body: "b", message }));
}

function ok<T>(value: T) {
  return Result.ok<T, LaunchpadApiError>(value);
}

function response(okValue: boolean, location: string | null) {
  return {
    ok: okValue,
    status: okValue ? 201 : 400,
    url: "https://api.launchpad.net/devel/mp",
    text: async () => "bad request",
    headers: { get: () => location },
  } as Response;
}

describe("LaunchpadApi", () => {
  it("fetches current user and merge proposal metadata", async () => {
    const api = new TestApi();
    api.jsonQueue.push(
      ok({ name: "me" }),
      ok({ sourceGitPath: "refs/heads/source", target_git_path: "refs/heads/target" }),
      ok({ source_git_path: "refs/heads/source2", targetGitPath: "refs/heads/target2" }),
    );

    await expect(api.me()).resolves.toMatchObject({ value: { name: "me" } });
    const mp = await api.getMergeProposal("https://api.launchpad.net/devel/~u/+git/r/merge/12");
    expect(mp.isOk()).toBe(true);
    if (mp.isOk()) expect(mp.value.parsed).toEqual({ id: 12, sourceBranch: "refs/heads/source", targetBranch: "refs/heads/target" });
    const fallback = await api.getMergeProposal("https://api.launchpad.net/devel/no-id");
    expect(fallback.isOk()).toBe(true);
    if (fallback.isOk()) expect(fallback.value.parsed).toEqual({ id: 0, sourceBranch: "refs/heads/source2", targetBranch: "refs/heads/target2" });
  });

  it("returns merge proposal errors", async () => {
    const api = new TestApi();
    api.jsonQueue.push(err());
    expect((await api.getMergeProposal("https://api.launchpad.net/devel/no-id")).isErr()).toBe(true);
  });

  it("fetches preview diff metadata and files", async () => {
    const api = new TestApi();
    api.jsonQueue.push(ok({ entries: [] }), ok({ diff_text_link: "link" }));

    expect((await api.getPreviewDiffs("https://api.launchpad.net/devel/mp")).isOk()).toBe(true);
    expect(api.calls[0]).toMatchObject({ url: "https://api.launchpad.net/devel/mp/preview_diffs" });
    expect((await api.getDiffFiles("https://api.launchpad.net/devel/~u/+git/r/+merge/1", 4)).isOk()).toBe(true);
    expect(api.calls[1]).toMatchObject({ url: "https://code.launchpad.net/~u/+git/r/+merge/1/+preview-diff/4" });
  });

  it("reads diff content and rejects non-diff text", async () => {
    const api = new TestApi();
    api.textQueue.push(ok("diff --git a b"), ok("html"), err());

    expect((await api.getDiffContent("diff-link")).isOk()).toBe(true);
    const invalid = await api.getDiffContent("diff-link");
    expect(invalid.isErr()).toBe(true);
    const failed = await api.getDiffContent("diff-link");
    expect(failed.isErr()).toBe(true);
  });

  it("fetches comments and inline comments", async () => {
    const api = new TestApi();
    api.jsonQueue.push(
      ok({ entries: [{ content: "one" }] }),
      ok({}),
      err(),
      ok([{ line_number: "9", date: "2020-01-01T00:00:00Z", text: "inline" }, { lineNumber: 10, dateCreated: "2020-01-02T00:00:00Z", content: "inline2" }, { text: "fallback" }]),
      ok({}),
      err(),
    );

    expect(await api.getComments("mp")).toMatchObject({ value: [{ content: "one" }] });
    expect(await api.getComments("mp")).toMatchObject({ value: [] });
    expect((await api.getComments("mp")).isErr()).toBe(true);
    const inline = await api.getInlineComments("mp", "https://api.launchpad.net/devel/mp/+preview-diff/7");
    expect(inline.isOk()).toBe(true);
    if (inline.isOk()) expect(inline.value.map((comment) => comment.id)).toEqual(["9-1577836800000", "10-1577923200000", "0-NaN"]);
    expect(await api.getInlineComments("mp", "https://api.launchpad.net/devel/mp/+preview-diff/7")).toMatchObject({ value: [] });
    expect((await api.getInlineComments("mp", "https://api.launchpad.net/devel/mp/+preview-diff/7")).isErr()).toBe(true);
  });

  it("posts comments and handles createComment failures", async () => {
    const api = new TestApi();
    api.requestQueue.push(ok(response(true, "comment-url")), ok(response(true, null)), ok(response(false, null)), err());

    expect(await api.postComment("https://code.launchpad.net/~u/+git/r/+merge/1", "body", "Approve", { "2": "ok" }, 3)).toMatchObject({ value: "comment-url" });
    expect(await api.postComment("https://code.launchpad.net/~u/+git/r/+merge/1")).toMatchObject({ value: "" });
    expect((await api.postComment("https://code.launchpad.net/~u/+git/r/+merge/1")).isErr()).toBe(true);
    expect((await api.postComment("https://code.launchpad.net/~u/+git/r/+merge/1")).isErr()).toBe(true);
  });

  it("calls parity endpoints", async () => {
    const api = new TestApi();
    api.jsonQueue.push(
      ok({ name: "proj" }),
      ok({ entries: [] }),
      ok(true),
      ok(false),
      ok({ isApproved: true }),
      ok({ optionalCriteria: { CIChecksPassed: true } }),
      err(),
      ok({ commitSha1: "abc" }),
      ok({ entries: [{ title: "ci" }] }),
      ok({ updated: true }),
      ok({ status: true }),
      ok({ status: true }),
      ok({ edited: true }),
      ok({ deleted: true }),
      ok({ entries: [] }),
      ok({ saved: true }),
      ok({ entries: [{ name: "person" }] }),
    );

    expect((await api.getProject("ubuntu")).isOk()).toBe(true);
    expect((await api.getMergeProposalVotes("mp")).isOk()).toBe(true);
    expect((await api.isPersonTrustedReviewer("repo", "person")).isOk()).toBe(true);
    expect((await api.canIMerge("mp")).isOk()).toBe(true);
    expect((await api.getMergeCriteria("mp")).isOk()).toBe(true);
    expect((await api.getMergeCriteria("mp")).isOk()).toBe(true);
    expect(await api.getLatestStatusReports("repo", "refs/heads/main")).toMatchObject({ value: { entries: [] } });
    expect(await api.getLatestStatusReports("repo", "main")).toMatchObject({ value: { entries: [{ title: "ci" }] } });
    expect((await api.updateMergeProposal("mp", { commitMessage: "msg" })).isOk()).toBe(true);
    expect((await api.setMergeProposalStatus("mp", { revid: null })).isOk()).toBe(true);
    expect((await api.setMergeProposalStatus("mp", { revid: "abc" })).isOk()).toBe(true);
    expect((await api.updateComment("comment", "new")).isOk()).toBe(true);
    expect((await api.deleteComment("comment")).isOk()).toBe(true);
    expect((await api.getDraftInlineComments("mp", "https://api.launchpad.net/devel/mp/+preview-diff/7")).isOk()).toBe(true);
    expect((await api.postDraftInlineComment("mp", 7, { "1": "draft" })).isOk()).toBe(true);
    expect((await api.searchPersons("name")).isOk()).toBe(true);
  });

  it("returns merge criteria errors and posts merge payloads", async () => {
    const api = new TestApi();
    api.jsonQueue.push(err(), ok({ merged: true }));
    expect((await api.getMergeCriteria("mp")).isErr()).toBe(true);
    expect((await api.merge("mp", { commitMessage: "msg" })).isOk()).toBe(true);
  });
});

describe("Launchpad SDK errors", () => {
  it("constructs tagged errors", () => {
    expect(new LaunchpadApiError({ status: 400, url: "u", body: "b", message: "m" })._tag).toBe("LaunchpadApiError");
    expect(new LaunchpadConfigError({ message: "missing" })._tag).toBe("LaunchpadConfigError");
  });
});
