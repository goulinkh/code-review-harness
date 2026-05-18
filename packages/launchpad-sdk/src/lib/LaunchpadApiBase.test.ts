import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: fetchMock };
});

import { LaunchpadApiBase } from "./LaunchpadApiBase.js";
import { LaunchpadApiError } from "./errors.js";

class TestBase extends LaunchpadApiBase {
  readText(url: string) {
    return this.text(url);
  }

  readSnakeBody(value: unknown) {
    return this.snakeBody(value);
  }
}

function createApi() {
  return new TestBase({ accessToken: "token", accessSecret: "secret", consumerKey: "consumer", consumerSecret: "consumer-secret", serviceRoot: "https://api.example.test/root/" });
}

function createResponse(options: { ok?: boolean; status?: number; statusText?: string; url?: string; text?: () => Promise<string>; location?: string }) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    url: options.url ?? "https://api.example.test/root/path",
    text: options.text ?? (async () => '{"queue_status":"Merged"}'),
    headers: { get: (name: string) => name === "Location" ? options.location ?? null : null },
  };
}

describe("LaunchpadApiBase", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("signs and sends requests with resolved params and serialized bodies", async () => {
    fetchMock.mockResolvedValue(createResponse({}));
    const result = await createApi().request("path", { method: "POST", params: { "ws.op": "op" }, body: { queueStatus: "Merged", count: 1 } });

    expect(result.isOk()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/root/path?ws.op=op");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe("queue_status=Merged&count=1");
    expect(init.headers.get("Authorization")).toContain("OAuth");
    expect(init.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
  });

  it("keeps caller content type and string bodies", async () => {
    fetchMock.mockResolvedValue(createResponse({}));
    await createApi().request("path", { body: "x=1", headers: { "Content-Type": "text/plain" } });
    expect(fetchMock.mock.calls[0]![1].headers.get("Content-Type")).toBe("text/plain");
    expect(fetchMock.mock.calls[0]![1].body).toBe("x=1");
  });

  it("handles null, URLSearchParams, and ArrayBuffer bodies", async () => {
    fetchMock.mockResolvedValue(createResponse({}));
    await createApi().request("path", { body: null });
    expect(fetchMock.mock.calls[0]![1].body).toBeUndefined();

    await createApi().request("path", { body: new URLSearchParams({ a: "1" }) });
    expect(String(fetchMock.mock.calls[1]![1].body)).toBe("a=1");

    const buffer = new ArrayBuffer(1);
    await createApi().request("path", { body: buffer });
    expect(fetchMock.mock.calls[2]![1].body).toBe(buffer);
  });

  it("returns network errors as LaunchpadApiError", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const result = await createApi().request("path");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toBeInstanceOf(LaunchpadApiError);
  });

  it("formats non-Error network failures", async () => {
    fetchMock.mockRejectedValue("offline");
    const result = await createApi().request("path");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toBe("Network error: offline");
  });

  it("parses JSON and converts response fields", async () => {
    fetchMock.mockResolvedValue(createResponse({ text: async () => '{"queue_status":"Merged"}' }));
    const result = await createApi().json<{ queueStatus: string }>("path");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({ queueStatus: "Merged" });
  });

  it("can skip JSON field conversion and parse empty bodies", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ text: async () => '{"queue_status":"Merged"}' }));
    const raw = await createApi().json("path", { convertFields: false });
    expect(raw.isOk()).toBe(true);
    if (raw.isOk()) expect(raw.value).toEqual({ queue_status: "Merged" });

    fetchMock.mockResolvedValueOnce(createResponse({ text: async () => "" }));
    const empty = await createApi().json("path");
    expect(empty.isOk()).toBe(true);
    if (empty.isOk()) expect(empty.value).toBeUndefined();
  });

  it("returns JSON errors for non-2xx and parse failures", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ ok: false, status: 503, statusText: "Nope", text: async () => "broken" }));
    const failed = await createApi().json("path", { name: "label" });
    expect(failed.isErr()).toBe(true);
    if (failed.isErr()) expect(failed.error.message).toBe("label failed: 503 Nope");

    fetchMock.mockResolvedValueOnce(createResponse({ ok: false, status: 500, statusText: "Nope", text: async () => "broken" }));
    const unnamed = await createApi().json("path");
    expect(unnamed.isErr()).toBe(true);
    if (unnamed.isErr()) expect(unnamed.error.message).toBe("Launchpad request failed: 500 Nope");

    fetchMock.mockResolvedValueOnce(createResponse({ text: async () => "{" }));
    const invalid = await createApi().json("path");
    expect(invalid.isErr()).toBe(true);
    if (invalid.isErr()) expect(invalid.error.message).toContain("JSON parse error");

    fetchMock.mockResolvedValueOnce(createResponse({ text: async () => { throw "bad-json"; } }));
    const thrownString = await createApi().json("path");
    expect(thrownString.isErr()).toBe(true);
    if (thrownString.isErr()) expect(thrownString.error.message).toBe("JSON parse error: bad-json");
  });

  it("returns request errors through json", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const result = await createApi().json("path");
    expect(result.isErr()).toBe(true);
  });

  it("reads text responses and handles text failures", async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ text: async () => "diff --git a b" }));
    const text = await createApi().readText("path");
    expect(text.isOk()).toBe(true);
    if (text.isOk()) expect(text.value).toBe("diff --git a b");

    fetchMock.mockResolvedValueOnce(createResponse({ ok: false, status: 404, text: async () => "missing" }));
    const missing = await createApi().readText("path");
    expect(missing.isErr()).toBe(true);

    fetchMock.mockResolvedValueOnce(createResponse({ text: async () => { throw new Error("stream"); } }));
    const broken = await createApi().readText("path");
    expect(broken.isErr()).toBe(true);

    fetchMock.mockResolvedValueOnce(createResponse({ text: async () => { throw "stream"; } }));
    const thrownString = await createApi().readText("path");
    expect(thrownString.isErr()).toBe(true);
  });

  it("returns request errors through text and exposes snakeBody", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect((await createApi().readText("path")).isErr()).toBe(true);
    expect(createApi().readSnakeBody({ queueStatus: "Merged", count: 1 })).toBe("queue_status=Merged&count=1");
    expect(createApi().readSnakeBody({})).toBe("");
  });
});
