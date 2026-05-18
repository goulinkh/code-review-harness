/**
 * Low-level Launchpad HTTP substrate.
 *
 * Handles OAuth 1.0a HMAC-SHA1 request signing, URL resolution against the
 * service root, and JSON/text response parsing. All methods return
 * `Result<T, LaunchpadApiError>` — callers must branch on `isOk`/`isErr`
 * rather than catching exceptions for expected LP failures.
 */
import { createHmac } from "node:crypto";
import OAuth from "oauth-1.0a";
import { fetch, Headers, type BodyInit, type Response } from "undici";
import { Result } from "better-result";
import { LaunchpadApiError } from "./errors.js";
import { convertCamelToSnake, convertSnakeToCamel } from "./utils.js";
import type { JsonRequestOptions, LaunchpadApiBaseOptions, LaunchpadRequestOptions } from "./types.js";

export class LaunchpadApiBase {
  readonly serviceRoot: string;
  private readonly oauth: OAuth;
  private readonly token: OAuth.Token;

  constructor(options: LaunchpadApiBaseOptions) {
    this.serviceRoot = options.serviceRoot ?? "https://api.launchpad.net/devel/";
    this.oauth = new OAuth({
      consumer: { key: options.consumerKey ?? "crh", secret: options.consumerSecret ?? "" },
      signature_method: "HMAC-SHA1",
      hash_function: (baseString, key) => createHmac("sha1", key).update(baseString).digest("base64"),
    });
    this.token = { key: options.accessToken, secret: options.accessSecret };
  }

  /** @note Impure — signs and sends a network request to Launchpad. */
  async request(url: string, options: LaunchpadRequestOptions = {}): Promise<Result<Response, LaunchpadApiError>> {
    const target = this.resolveUrl(url, options.params);
    const method = options.method ?? "GET";
    const body = serializeBody(options.body);
    const headers = new Headers(options.headers);
    const auth = this.oauth.toHeader(this.oauth.authorize({ url: target, method }, this.token));
    headers.set("Authorization", auth.Authorization);
    if (body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }
    return Result.tryPromise({
      try: () => fetch(target, { ...options, method, body, headers }),
      catch: (e) =>
        new LaunchpadApiError({
          status: 0,
          url: target,
          body: "",
          message: `Network error: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });
  }

  /** @note Impure — performs network I/O and parses Launchpad JSON responses. */
  async json<T>(url: string, options: JsonRequestOptions = {}): Promise<Result<T, LaunchpadApiError>> {
    const responseResult = await this.request(url, options);
    if (responseResult.isErr()) return responseResult;
    const response = responseResult.value;
    if (!response.ok) {
      const body = await response.text();
      return Result.err(
        new LaunchpadApiError({
          status: response.status,
          url: response.url,
          body: body.slice(0, 500),
          message: `${options.name ?? "Launchpad request"} failed: ${response.status} ${response.statusText}`,
        }),
      );
    }
    return Result.tryPromise({
      try: async () => {
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : undefined;
        return (options.convertFields === false ? parsed : convertSnakeToCamel(parsed)) as T;
      },
      catch: (e) =>
        new LaunchpadApiError({
          status: response.status,
          url: response.url,
          body: "",
          message: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });
  }

  /** @note Impure — performs network I/O and reads Launchpad text responses. */
  protected async text(url: string, options: JsonRequestOptions = {}): Promise<Result<string, LaunchpadApiError>> {
    const responseResult = await this.request(url, options);
    if (responseResult.isErr()) return responseResult;
    const response = responseResult.value;
    if (!response.ok) {
      const body = await response.text();
      return Result.err(
        new LaunchpadApiError({
          status: response.status,
          url: response.url,
          body: body.slice(0, 500),
          message: `Launchpad text request failed: ${response.status}`,
        }),
      );
    }
    return Result.tryPromise({
      try: () => response.text(),
      catch: (e) =>
        new LaunchpadApiError({
          status: response.status,
          url: response.url,
          body: "",
          message: `Read error: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });
  }

  protected snakeBody(value: unknown): string {
    return new URLSearchParams(convertCamelToSnake(value) as Record<string, string>).toString();
  }

  private resolveUrl(url: string, params: Record<string, string> | undefined): string {
    const resolved = new URL(url, this.serviceRoot);
    for (const [key, value] of Object.entries(params ?? {})) {
      resolved.searchParams.set(key, value);
    }
    return resolved.toString();
  }
}

function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string" || body instanceof URLSearchParams || body instanceof ArrayBuffer) {
    return body;
  }
  const result = Result.try(() => new URLSearchParams(stringifyRecord(convertCamelToSnake(body) as Record<string, unknown>)).toString());
  return result.unwrapOr(undefined);
}

function stringifyRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry === "string" ? entry : JSON.stringify(entry)]));
}
