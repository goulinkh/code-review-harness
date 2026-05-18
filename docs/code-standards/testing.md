# Testing Standards

Standards for testing development.

> **Scope:** Currently targets TypeScript/JavaScript projects.

## cs:testing.file.structure

Unit test files must be colocated with the source they test, using the `.test.ts` suffix (`.test.tsx` for component tests). Other test types (browser, e2e) may follow different naming conventions. Shared test infrastructure — fixtures, factory helpers, custom matchers, type definitions — lives in a `testing/` directory at the package root (not inside `src/`). This directory is excluded from coverage and from the package's public API. Integration tests that exercise multiple modules together go in `src/testing/integration/`. Do not place test files in a top-level `__tests__/` or `tests/` directory mirroring the source tree. Do not use `.spec.ts` — the convention is `.test.ts`.

### Do

Colocate test files next to the source they test, with shared infrastructure in `testing/`.
```
packages/my-package/
├── src/
│   ├── parseThing.ts
│   ├── parseThing.test.ts        # colocated with source
│   ├── formatThing.ts
│   └── formatThing.test.ts
├── testing/
│   ├── fixtures.ts               # shared test data
│   ├── createTestDb.ts             # factory helpers
│   ├── registerMatchers.ts        # custom vitest matchers
│   └── types.ts                   # test-only type definitions
└── vitest.config.ts
```

Place integration tests in `src/testing/integration/`.
```
packages/my-package/
├── src/
│   ├── testing/
│   │   └── integration/
│   │       └── checkout-flow.test.ts
```

### Don't

Place test files in a separate `__tests__/` or `tests/` directory mirroring the source tree, or use `.spec.ts`.
```
packages/my-package/
├── src/
│   ├── parseThing.ts
│   └── formatThing.ts
├── __tests__/                    # Bad: mirrored directory
│   ├── parseThing.spec.ts        # Bad: .spec.ts suffix
│   └── formatThing.spec.ts
```

---

# Coverage

> **Scope:** Targets TypeScript/JavaScript projects using vitest and the V8 coverage provider.

## cs:testing.coverage.config

New packages with runtime code must enforce 100% coverage thresholds using vitest with the v8 provider. Existing packages should ratchet toward 100% over time. Every package that exports runtime code (not pure types or CSS) must configure vitest coverage. The `test:coverage` script in `package.json` runs `vitest run --coverage`. The plain `test` script runs `vitest run` without coverage for speed during development. Package-specific exclusions are acceptable when justified (e.g., `**/types/*.ts` for packages with type directories, third-party wrappers). Each addition to `exclude` must be a category of non-runtime code, not a way to skip hard-to-test source.

### Do

Configure vitest with v8 coverage provider and 100% thresholds with standard exclusions.
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "**/index.ts",       // barrel re-exports
        "**/*.test.ts",      // test files
        "**/*.test.tsx",     // component test files
        "**/*.d.ts",         // type declarations
        "**/types.ts",       // type-only files
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
```

### Don't

Omit coverage thresholds or use thresholds below 100%.
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Bad: no thresholds — coverage is informational only
    },
  },
});
```

Add source files to `exclude` to avoid writing tests for them.
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "src/hardToTest.ts",   // Bad: skipping testable source
        "src/legacy/**/*.ts",  // Bad: blanket exclusion of source
      ],
    },
  },
});
```

---

## cs:testing.coverage.ignore_pragma

`v8 ignore` pragmas must be reserved for structurally unreachable branches, not testable-but-inconvenient code. Acceptable uses include: runtime detection (`typeof Bun !== "undefined"`), environment variables (`process.env.HOME ?? ""`), exhaustive switch defaults after all discriminated union members are handled, and intentional no-ops (empty callback functions passed to framework APIs). Unacceptable uses include: `?? ""` on `Map.get()` where the key was conditionally set, `if (!x)` guard after a length check, and `error instanceof Error` in catch blocks. Each pragma must include a `--` comment explaining why the branch is unreachable.

### Do

Include a `--` comment explaining why the branch is structurally unreachable.
```typescript
/* v8 ignore next 7 -- Bun.Glob branch; only reachable under Bun runtime */
if (typeof Bun !== "undefined" && Bun.Glob) {
  // Bun-specific glob implementation
}
```

Use `v8 ignore` for exhaustive switch defaults that TypeScript guarantees are unreachable.
```typescript
switch (kind) {
  case "add": return handleAdd(effect);
  case "remove": return handleRemove(effect);
  /* v8 ignore next -- exhaustive: all EffectKind members handled above */
  default: return false;
}
```

### Don't

Use `v8 ignore` without an explanation, or to suppress a testable branch.
```typescript
/* v8 ignore next */
if (modified) { result = modified; }
```

---

# Integration Testing

> **Scope:** Targets TypeScript/JavaScript projects.

## cs:testing.integration.structure

Integration tests that exercise multiple modules together must live in `src/testing/integration/` and test observable outcomes, not internal wiring. Integration tests verify that modules compose correctly — that a pipeline produces the right output, that a query returns the right results, that a template renders with all helpers available. They must use real implementations (not mocks), be named after the capability they verify (not the modules they touch), and clean up any state they create. Do not place integration tests next to unit tests without the `integration/` directory. Do not test cross-package integration in library packages — that belongs at the application layer.

### Do

Place integration tests in `src/testing/integration/` and test observable outcomes.
```typescript
// src/testing/integration/checkout-flow.test.ts
describe("checkout flow", () => {
  it("applies discount and calculates correct total", () => {
    const cart = createCart([{ sku: "A1", qty: 2, price: 50 }]);
    applyDiscount(cart, "SAVE10");
    const receipt = checkout(cart);
    expect(receipt.total).toBe(90);
  });
});
```

### Don't

Place integration tests next to unit tests or test internal wiring instead of outcomes.
```typescript
// Bad: integration test sitting next to unit tests
// src/checkout/checkout.integration.test.ts

// Bad: testing internal wiring instead of outcomes
it("calls validateCart then applyDiscount then chargePayment", () => {
  const spy1 = vi.spyOn(mod, "validateCart");
  const spy2 = vi.spyOn(mod, "applyDiscount");
  checkout(cart);
  expect(spy1).toHaveBeenCalledBefore(spy2);
});
```

---

# Unit Testing

> **Scope:** Targets TypeScript/JavaScript projects using vitest.

## cs:testing.unit.describe_organization

Test files must use hierarchical `describe` blocks that mirror the module's public API. Each exported function or behavior gets its own `describe`. The top-level `describe` names the module under test. Nested `describe` blocks group by exported function, method, or logical behavior. Individual `it` blocks describe specific input/output scenarios. For files that export multiple functions, use a top-level `describe` per export. Do not use `test()` as a synonym for `it()` — use `it()` consistently. Do not create deeply nested describe trees (3+ levels) — flatten by splitting into separate describe blocks or separate test files.

### Do

Use hierarchical `describe` blocks mirroring the module's public API.
```typescript
// parseThing.test.ts
describe("parseThing", () => {
  describe("with valid input", () => {
    it("parses a simple value", () => { /* ... */ });
    it("handles optional fields", () => { /* ... */ });
  });

  describe("with invalid input", () => {
    it("throws on empty string", () => { /* ... */ });
    it("throws on malformed structure", () => { /* ... */ });
  });

  describe("edge cases", () => {
    it("handles unicode characters", () => { /* ... */ });
    it("handles maximum length input", () => { /* ... */ });
  });
});
```

Use a top-level `describe` per export when a file exports multiple functions.
```typescript
// formatEffects.test.ts
describe("formatLogEffect", () => { /* ... */ });
describe("formatPromptEffect", () => { /* ... */ });
describe("formatFileEffect", () => { /* ... */ });
```

### Don't

Use `test()` instead of `it()`, or create deeply nested describe trees.
```typescript
// Bad: mixing test() and it(), deeply nested
describe("parseThing", () => {
  describe("valid", () => {
    describe("simple", () => {
      describe("strings", () => {
        test("parses a string", () => { /* ... */ }); // Bad: test() instead of it()
      });
    });
  });
});
```

---

## cs:testing.unit.fixtures_pattern

Test fixtures must be defined in `testing/fixtures.ts` as named exports. Factory helpers that create stateful test objects get their own files in `testing/`. Static test data (strings, objects, configuration samples) belongs in `testing/fixtures.ts`. Custom vitest matchers go in `testing/registerMatchers.ts`. Test-only type definitions go in `testing/types.ts`. Do not inline large fixture data in test files. Do not use JSON fixture files — TypeScript exports are type-safe and importable.

### Do

Define static fixtures as named exports in `testing/fixtures.ts`.
```typescript
// testing/fixtures.ts
export const testUser: User = {
  id: "user-1",
  name: "Alice",
  role: "admin",
};

export const validConfigYaml = `
  host: localhost
  port: 3000
  debug: true
`;

export const multiServerConfig = {
  servers: [{ name: "a" }, { name: "b" }],
};
```

Place factory helpers that create stateful objects in their own files in `testing/`.
```typescript
// testing/createTestDb.ts
export function createTestDb(seed: Record<string, unknown>[]): Database {
  const db = new Database(":memory:");
  for (const row of seed) db.insert(row);
  return db;
}
```

### Don't

Inline large fixture data directly in test files or use JSON fixture files.
```typescript
// Bad: large fixture inlined in test file
const seedData = [
  { id: "1", name: "Alice", role: "admin" },
  { id: "2", name: "Bob", role: "editor" },
  { id: "3", name: "Carol", role: "viewer" },
  // ... 50 more rows ...
];

// Bad: JSON fixture file instead of typed TypeScript export
import fixture from "../fixtures/config.json";
```

---

## cs:testing.unit.mocking_minimal

Prefer real execution over mocks. Mock only at system boundaries where real execution is impossible or destructive. Mocking internal modules to simplify test setup produces tests that pass when the contract is broken. Acceptable mocking targets: filesystem (`node:fs/promises`), network (HTTP clients, external API calls), process/runtime (`process.exit`), and time (`vi.useFakeTimers()`). Mocking internal modules is acceptable when needed to trigger specific edge cases (error paths, race conditions) that are impractical to reproduce otherwise. Avoid mocking: pure functions, configuration/constants, or other packages in the monorepo.

### Do

Use a factory helper to create real test dependencies instead of mocking them.
```typescript
// testing/createTestDb.ts
export function createTestDb(seed: Record<string, unknown>[]): Database {
  const db = new Database(":memory:");
  for (const row of seed) db.insert(row);
  return db;
}
```

Mock only at genuine system boundaries like the filesystem.
```typescript
import { vi } from "vitest";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

it("discovers config files in directory", async () => {
  vi.mocked(fs.readdir).mockResolvedValue(["config.json", "README.md"]);
  const configs = await discoverConfigs("/app");
  expect(configs).toEqual(["config.json"]);
});
```

### Don't

Mock internal modules within the same package to simplify test setup.
```typescript
// Bad: mocking an internal module hides contract breakage
vi.mock("./parseConfig");
vi.mocked(parseConfig).mockReturnValue({ host: "localhost" });

it("uses parsed config", () => {
  const result = buildConnection();
  // This test passes even if parseConfig's real output changes
  expect(result.host).toBe("localhost");
});
```

---
