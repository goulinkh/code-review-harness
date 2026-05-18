import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getModel: vi.fn(() => ({
    id: "model",
    name: "Model",
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  })),
  createReviewSession: vi.fn(),
  createLaunchpadProvider: vi.fn(() => "provider"),
  createLaunchpadSink: vi.fn(() => "launchpad-sink"),
  createStdoutSink: vi.fn(() => "stdout-sink"),
}));

vi.mock("@earendil-works/pi-ai", () => ({ getModel: mocks.getModel }));
vi.mock("@code-review-harness/core", () => ({ createReviewSession: mocks.createReviewSession }));
vi.mock("@code-review-harness/launchpad-provider", () => ({ createLaunchpadProvider: mocks.createLaunchpadProvider }));
vi.mock("@code-review-harness/launchpad-sink", () => ({ createLaunchpadSink: mocks.createLaunchpadSink }));
vi.mock("@code-review-harness/stdout-sink", () => ({ createStdoutSink: mocks.createStdoutSink }));

import { createReviewCommand } from "./createReviewCommand.js";

describe("createReviewCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getModel.mockReturnValue({
      id: "model",
      name: "Model",
      api: "openai-responses",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    });
    mocks.createLaunchpadProvider.mockReturnValue("provider");
    mocks.createLaunchpadSink.mockReturnValue("launchpad-sink");
    mocks.createStdoutSink.mockReturnValue("stdout-sink");
    mocks.createReviewSession.mockResolvedValue({ session: { subscribe: vi.fn((handler) => handler({ type: "event" })), prompt: vi.fn() } });
  });

  it("registers review command options", () => {
    const command = createReviewCommand();
    expect(command.name()).toBe("review");
    expect(command.options.map((option) => option.long)).toEqual(["--provider", "--pr", "--sink", "--model", "--model-base-url", "--no-sandbox", "--config", "--debug"]);
  });

  it("rejects unsupported providers before creating sessions", async () => {
    const command = createReviewCommand();
    command.exitOverride();
    await expect(command.parseAsync(["node", "review", "--provider", "github", "--pr", "x"], { from: "user" })).rejects.toThrow("Unsupported provider: github");
  });

  it("runs review with launchpad sink and parsed model", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await createReviewCommand().parseAsync(["node", "review", "--provider", "launchpad", "--pr", "mp", "--sink", "launchpad", "--model", "anthropic:model"], { from: "user" });

    expect(mocks.createLaunchpadProvider).toHaveBeenCalledWith({ url: "mp" });
    expect(mocks.createLaunchpadSink).toHaveBeenCalledWith({ url: "mp" });
    expect(mocks.getModel).toHaveBeenCalledWith("anthropic", "model");
    expect(mocks.createReviewSession).toHaveBeenCalledWith(expect.objectContaining({ provider: "provider", sink: "launchpad-sink", model: expect.objectContaining({ id: "model" }) }));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Starting review"));
  });

  it("runs review with stdout sink and undefined malformed model", async () => {
    await createReviewCommand().parseAsync(["node", "review", "--provider", "launchpad", "--pr", "mp", "--model", "malformed"], { from: "user" });

    expect(mocks.createStdoutSink).toHaveBeenCalled();
    expect(mocks.getModel).not.toHaveBeenCalled();
    expect(mocks.createReviewSession).toHaveBeenCalledWith(expect.objectContaining({ provider: "provider", sink: "stdout-sink", model: undefined }));
  });

  it("overrides OpenAI model base URL", async () => {
    await createReviewCommand().parseAsync(["node", "review", "--provider", "launchpad", "--pr", "mp", "--model", "openai:gpt-4.1", "--model-base-url", "https://models.example/v1"], { from: "user" });

    expect(mocks.getModel).toHaveBeenCalledWith("openai", "gpt-4.1");
    expect(mocks.createReviewSession).toHaveBeenCalledWith(expect.objectContaining({
      provider: "provider",
      sink: "stdout-sink",
      model: expect.objectContaining({ api: "openai-responses", provider: "openai", baseUrl: "https://models.example/v1" }),
    }));
  });

  it("creates custom OpenAI model when base URL is provided", async () => {
    mocks.getModel.mockReturnValue(undefined);
    await createReviewCommand().parseAsync(["node", "review", "--provider", "launchpad", "--pr", "mp", "--model", "openai:custom-model", "--model-base-url", "https://models.example/v1"], { from: "user" });

    expect(mocks.createReviewSession).toHaveBeenCalledWith(expect.objectContaining({
      provider: "provider",
      sink: "stdout-sink",
      model: expect.objectContaining({ id: "custom-model", api: "openai-completions", provider: "openai", baseUrl: "https://models.example/v1" }),
    }));
  });

  it("overrides registered OpenAI-compatible model base URL", async () => {
    mocks.getModel.mockReturnValue({
      id: "kimi-k2.6",
      name: "Kimi K2.6",
      api: "openai-completions",
      provider: "moonshotai",
      baseUrl: "https://api.moonshot.ai/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    });
    await createReviewCommand().parseAsync(["node", "review", "--provider", "launchpad", "--pr", "mp", "--model", "moonshotai:kimi-k2.6", "--model-base-url", "https://models.example/v1"], { from: "user" });

    expect(mocks.createReviewSession).toHaveBeenCalledWith(expect.objectContaining({
      provider: "provider",
      sink: "stdout-sink",
      model: expect.objectContaining({ id: "kimi-k2.6", api: "openai-completions", provider: "moonshotai", baseUrl: "https://models.example/v1" }),
    }));
  });

  it("rejects custom base URL for non-OpenAI-compatible providers", async () => {
    mocks.getModel.mockReturnValue({
      id: "model",
      name: "Model",
      api: "anthropic-messages",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    });
    const command = createReviewCommand();
    command.exitOverride();
    await expect(command.parseAsync(["node", "review", "--provider", "launchpad", "--pr", "mp", "--model", "anthropic:model", "--model-base-url", "https://models.example/v1"], { from: "user" })).rejects.toThrow("--model-base-url requires an OpenAI-compatible model");
  });
});
