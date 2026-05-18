import { describe, expect, it } from "vitest";
import { ToolInputError, UnsupportedRepoTypeError, WorkspaceError } from "./errors.js";

describe("core errors", () => {
  it("constructs tagged errors", () => {
    expect(new UnsupportedRepoTypeError({ url: "u", message: "m" })._tag).toBe("UnsupportedRepoTypeError");
    expect(new WorkspaceError({ path: "p", message: "m" })._tag).toBe("WorkspaceError");
    expect(new ToolInputError({ message: "m" })._tag).toBe("ToolInputError");
  });
});
