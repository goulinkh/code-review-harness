import { describe, expect, it } from "vitest";
import { stableJson } from "./stableJson.js";

describe("stableJson", () => {
  it("sorts object keys recursively and preserves arrays", () => {
    expect(stableJson({ b: 1, a: [{ d: 4, c: 3 }] })).toBe('{\n  "a": [\n    {\n      "c": 3,\n      "d": 4\n    }\n  ],\n  "b": 1\n}\n');
  });
});
