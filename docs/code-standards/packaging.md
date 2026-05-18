# Packaging Standards

Standards for packaging development.

## cs:packaging.application.structure

Application packages (CLIs, servers, MCP tools, build scripts, workers) execute behavior through entry points. They are not imported as dependencies by other packages. Their internal code must be organized around execution domains (commands, routes, tools, operations) rather than library conventions like `src/lib/` or barrel re-exports. Each domain folder must have its own barrel file (`index.ts`) that defines the domain's internal API — sibling domains import through the barrel, never from individual files.

### Do

Recognise an application package by its `package.json` signals — `bin` field, `private: true`, no `main`/`exports`
```json
{
  "name": "@scope/my-cli",
  "private": true,
  "bin": { "my-cli": "./dist/index.js" }
}
```

Organize code around execution domains. Each domain folder gets its own barrel (`index.ts`) that exposes the domain's internal API to sibling domains
```
packages/my-cli/
├── src/
│   ├── commands/              # CLI command handlers
│   │   ├── build.ts
│   │   ├── deploy.ts
│   │   └── index.ts           # Barrel: exports all commands
│   ├── operations/            # Shared internal logic across commands
│   │   ├── resolveConfig.ts
│   │   ├── runValidation.ts
│   │   └── index.ts           # Barrel: exports shared operations
│   ├── utils/                 # Internal helpers
│   │   ├── formatOutput.ts
│   │   └── index.ts           # Barrel: exports utilities
│   └── index.ts               # Entry point (bootstraps CLI)
└── package.json
```

Import from sibling domains through their barrel, not from individual files
```typescript
// src/commands/deploy.ts
import { resolveConfig, runValidation } from "../operations/index.js";
import { formatOutput } from "../utils/index.js";
```

Use domain-appropriate folder names that reflect what the code does — `commands/`, `tools/`, `routes/`, `operations/`, `handlers/`
```
packages/my-mcp/
├── src/
│   ├── tools/                 # MCP tool handlers
│   │   ├── query.ts
│   │   ├── mutate.ts
│   │   └── index.ts           # Barrel: exports tool handlers
│   ├── operations/            # Shared internal logic
│   │   ├── executeQuery.ts
│   │   └── index.ts           # Barrel: exports shared operations
│   └── index.ts               # MCP server entry point
└── package.json
```

For **hybrid** packages (primarily application but exporting a small reusable surface), isolate the exported surface in `src/lib/` following library rules while keeping the rest as application structure
```
packages/my-mcp/
├── src/
│   ├── lib/                   # Only the reusable exported surface
│   │   ├── types.ts
│   │   └── index.ts           # Barrel: public API for external consumers
│   ├── tools/                 # MCP tool handlers (not exported)
│   │   ├── query.ts
│   │   ├── mutate.ts
│   │   └── index.ts           # Barrel: exports tool handlers
│   ├── operations/            # Shared internal logic
│   │   ├── executeQuery.ts
│   │   └── index.ts           # Barrel: exports shared operations
│   └── index.ts               # MCP server entry point
└── package.json
```

### Don't

Apply library structure (`src/lib/`, barrel re-exports) to application packages
```
// Bad: CLI tool forced into library layout
packages/my-cli/
├── src/
│   ├── lib/               # Wrong: this is a CLI, not a library
│   │   ├── commands/
│   │   └── index.ts       # Barrel re-export — nobody imports this
│   └── index.ts
```

Create a `src/lib/` folder for internal shared operations. Use domain-appropriate names instead
```
// Bad: "lib" implies external consumption
packages/my-cli/
├── src/
│   ├── lib/
│   │   └── resolveConfig.ts   # Only used internally

// Good: "operations" or "shared" makes intent clear
packages/my-cli/
├── src/
│   ├── operations/
│   │   └── resolveConfig.ts   # Internal shared logic
```

Import directly from files inside a sibling domain — always go through the domain barrel
```typescript
// Bad: reaching into a sibling domain's internals
import { resolveConfig } from "../operations/resolveConfig.js";
import { formatOutput } from "../utils/formatOutput.js";

// Good: import through the domain barrel
import { resolveConfig } from "../operations/index.js";
import { formatOutput } from "../utils/index.js";
```

Omit barrels from domain folders
```
// Bad: no barrels — every consumer imports individual files
packages/my-cli/
├── src/
│   ├── commands/
│   │   ├── build.ts
│   │   └── deploy.ts       # No index.ts — siblings must know file names
│   ├── operations/
│   │   ├── resolveConfig.ts
│   │   └── runValidation.ts # No index.ts — fragile cross-domain imports
```

Default to library structure just because the package lives in a monorepo
```
// Bad: reflexively adding lib/ to a build script package
packages/build-tools/
├── src/
│   ├── lib/               # This is a build script, not a library
│   │   └── runBuild.ts
│   └── index.ts
```

---

## cs:packaging.export.barrel

Every domain folder must have a barrel file (`index.ts`) that defines its API surface. In library packages, barrels define the public API for external consumers. In application packages, barrels define the internal API between sibling domains. Within a domain, implementation files import from siblings directly; cross-domain imports always go through the barrel.

### Do

Use a barrel at the package entry point to define the public API (library packages)
```typescript
// src/index.ts
export { Button } from "./components/Button.js";
export type { ButtonProps } from "./components/Button.types.js";
```

Use a barrel at each domain folder to define the domain's API (application packages)
```typescript
// src/operations/index.ts
export { resolveConfig } from "./resolveConfig.js";
export { runValidation } from "./runValidation.js";
```

Import internal implementation code within a domain from the owning file directly
```typescript
// src/build/buildTheme.ts — same domain, import the file
import { computeDeltas } from "./computeDeltas.js";
import { recoverPrimitiveRef } from "./recoverPrimitiveRef.js";
```

Import cross-domain code through the sibling domain's barrel
```typescript
// src/commands/deploy.ts — different domain, import through barrel
import { resolveConfig } from "../operations/index.js";
```

Keep compatibility barrels thin and documented as public facades
```typescript
/** Public compatibility surface. */
export { computeDeltas } from "./computeDeltas.js";
export { formatDelta } from "./formatDelta.js";
```

### Don't

Route internal same-domain code through its own barrel
```typescript
// Bad: internal implementation depends on its own barrel
// src/build/applyTheme.ts
import { computeDeltas, recoverPrimitiveRef } from "./index.js";
```

Import cross-domain code by reaching into individual files
```typescript
// Bad: bypassing the domain barrel
import { resolveConfig } from "../operations/resolveConfig.js";

// Good: through the barrel
import { resolveConfig } from "../operations/index.js";
```

Hide domain ownership behind convenience barrels
```typescript
// Bad: types appear to belong to context.ts instead of their owning domains
import type { Artifact, CSSNode, OverlayToken } from "./context.js";
```

Omit the barrel from a domain folder
```
// Bad: no index.ts — consumers must know internal file names
src/operations/
├── resolveConfig.ts
└── runValidation.ts
```

---

## cs:packaging.export.declaration

Exports must be declared on the definition itself (e.g. `export default function` or `export const`), not gathered at the end of the file. When a wrapper (HOC, decorator, middleware) is applied, declare the unwrapped binding with `const`, then export the wrapped result as default on a separate line.

### Do

Declare the export directly on the function or class definition
```typescript
// formatCurrency.ts
export default function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}
```

Declare the export directly on a named constant
```typescript
// MAX_RETRIES.ts
export const MAX_RETRIES = 3;
```

When a wrapper is involved, declare the raw binding with `const`, then export the wrapped result as default
```typescript
// UserProfile.tsx
const UserProfile = ({ user }: UserProfileProps) => {
  return <div>{user.name}</div>;
};

export default memo(UserProfile);
```

Apply the same pattern for higher-order functions and middleware
```typescript
// connectDatabase.ts
const connectDatabase = (config: DbConfig): Connection => {
  return new Connection(config);
};

export default withRetry(connectDatabase);
```

### Don't

Define a symbol and then export it at the end of the file
```typescript
// Bad: export is separated from definition
function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default formatCurrency;
```

Gather multiple exports at the bottom of the file
```typescript
// Bad: exports collected at the end
const helperA = () => {};
const helperB = () => {};

export { helperA, helperB };
```

Use `export default` on the raw binding when a wrapper is needed
```typescript
// Bad: exports the unwrapped version, then wraps elsewhere
export default function UserProfile({ user }: UserProfileProps) {
  return <div>{user.name}</div>;
}

// consumer.ts — has to wrap it themselves
import UserProfile from "./UserProfile.js";
const Memoized = memo(UserProfile);
```

---

## cs:packaging.export.shape

Files must use either a single default export or multiple named exports. When using multiple named exports, all exports must have the same type or shape.

### Do

Use a single default export for files implementing a single component or function
```typescript
// ComponentName.tsx
export default ComponentName;
```

Name atomic function files after the function they export
```typescript
// assignElement.ts
export default function assignElement(target: Element, source: Partial<Element>) {
  // ...
}

// formatCurrency.ts
export default function formatCurrency(value: number) {
  // ...
}
```

Use multiple named exports for files providing a public API or a collection of related items, and ensure all exports have the same type
```typescript
// index.ts
export { ComponentA, ComponentB };

// types.ts
export type TypeA = { ... };
export type TypeB = { ... };

// Consistent export shape:
export const myFuncA = (value: string) => {};
export const myFuncB = (value: string) => {};
export const myFuncC = (value: string) => {};
```

### Don't

Mix default and unrelated named exports in a way that confuses the file's purpose
```typescript
export default ComponentName;
export const helper = () => {};
```

Name an atomic function file with a name that doesn't match its exported function
```typescript
// helpers.ts — wrong: generic name instead of function name
export default function assignElement(target: Element, source: Partial<Element>) {
  // ...
}

// utils.ts — wrong: generic name instead of function name
export default function formatCurrency(value: number) {
  // ...
}
```

Provide multiple unrelated exports from a file meant for a single domain
```typescript
export default debounce;
export const throttle = () => {};
export const logger = () => {};
```

Export objects of different types or shapes from the same file
```typescript
export const transformer = (value: string) => {};
export const reducer = (map: string[]) => {};
class ABC {}
export { ABC };
```

---

## cs:packaging.import.cross_domain

Intra-package cross-domain imports must use Node.js subpath imports (the `imports` field in `package.json`) with the `#` prefix convention. Each `#` alias points directly to the domain's barrel file — no wildcard splats, no path suffixes, no extension mapping. With `moduleResolution: "nodenext"` (or `"node16"`), bare specifiers like `error/index.js` are treated as package names, not path-relative imports. The `paths` compiler option is a manual alias table — brittle and verbose. Subpath imports are the official Node.js mechanism, work natively with Node, Bun, vitest, and tsc, and require no plugins. TypeScript resolves them when `resolvePackageJsonImports` is enabled (on by default with `moduleResolution` set to `node16`, `nodenext`, or `bundler`).

### Do

Map each `#` alias directly to the domain barrel in `package.json` — no wildcards, no path suffixes
```json
{
  "imports": {
    "#config": "./src/config/index.ts",
    "#error": "./src/error/index.ts",
    "#pipeline": "./src/pipeline/index.ts",
    "#package-manager": "./src/package-manager/index.ts",
    "#constants": "./src/constants.ts"
  }
}
```

Import cross-domain modules using the `#` alias — clean, no path suffixes
```typescript
// src/pipeline/runPipeline.ts
import { PragmaError } from "#error";
import { resolveConfig } from "#config";
```

Use `moduleResolution: "nodenext"` (or `"node16"` / `"bundler"`) in `tsconfig.json` so TypeScript resolves subpath imports via `resolvePackageJsonImports` (enabled by default with these settings)
```json
{
  "compilerOptions": {
    "moduleResolution": "nodenext"
  }
}
```

Use conditional subpath imports when you need different resolutions for different environments
```json
{
  "imports": {
    "#db": {
      "development": "./src/db/mock.ts",
      "default": "./src/db/real.ts"
    }
  }
}
```

### Don't

Use wildcard splats or path suffixes in `#` aliases — point directly to the barrel instead
```json
// Bad: wildcard mapping forces consumers to know internal file structure
{
  "imports": {
    "#config/*": "./src/config/*",
    "#error/*": "./src/error/*"
  }
}

// Bad: path suffix leaks barrel structure into every import site
import { PragmaError } from "#error/index.js";
```

Use bare specifiers without the `#` prefix for intra-package imports — they resolve as package names under `nodenext`
```typescript
// Bad: "error/index.js" resolves as the npm package "error", not ./src/error/
import { PragmaError } from "error/index.js";
```

Use `paths` in `tsconfig.json` as a substitute for subpath imports — it's a manual alias table that doesn't participate in Node.js resolution
```json
// Bad: brittle, verbose, requires a bundler or ts-patch to work at runtime
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@error/*": ["src/error/*"],
      "@config/*": ["src/config/*"],
      "@pipeline/*": ["src/pipeline/*"]
    }
  }
}
```

Use deep relative paths to reach across domains — they break when folders move and obscure the dependency graph
```typescript
// Bad: fragile, hard to refactor
import { PragmaError } from "../../error/PragmaError.js";
import { resolveConfig } from "../../../config/resolveConfig.js";
```

Import specific files through the `#` alias — go through the barrel instead
```typescript
// Bad: bypasses the barrel, couples to internal file structure
import { readConfig } from "#config/readConfig.js";

// Good: import through the barrel
import { readConfig } from "#config";
```

---

## cs:packaging.library.structure

Library packages export reusable code (components, utilities, hooks, types) for consumption by other packages. They must organize their exportable code in a `src/lib/` folder and re-export through a root barrel. This convention ensures consistency across the monorepo and clearly separates public API code from non-exported concerns like storybook configuration or test utilities. Each domain folder within `lib/` must have its own barrel (`index.ts`).

### Do

Recognise a library package by its `package.json` signals — `main`/`exports` field, publishable, no `bin`
```json
{
  "name": "@scope/design-system",
  "main": "./dist/index.js",
  "exports": { ".": "./dist/index.js" }
}
```

Place all reusable/exportable code in `src/lib/`, with a barrel in each domain folder
```
packages/my-package/
├── src/
│   ├── lib/
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   ├── Button.tests.tsx
│   │   │   ├── types.ts
│   │   │   └── index.ts       # Barrel: exports Button public API
│   │   ├── hooks/
│   │   │   ├── useToggle.ts
│   │   │   └── index.ts       # Barrel: exports hooks
│   │   ├── types/
│   │   │   └── index.ts       # Barrel: exports shared types
│   │   └── index.ts           # Barrel: lib public API
│   ├── storybook/             # Storybook-specific files (not exported)
│   └── index.ts               # Re-exports from lib
└── package.json
```

Re-export from the lib folder in the package entry point
```typescript
// src/index.ts
export * from "./lib/index.js";
```

Use the lib barrel to compose the package's public API from domain barrels
```typescript
// src/lib/index.ts
export * from "./Button/index.js";
export * from "./hooks/index.js";
export type * from "./types/index.js";
```

### Don't

Use alternative folder names like `ui`, `components`, or `utils` for exportable code at the package level
```
// Bad: Using 'ui' instead of 'lib'
packages/my-package/
├── src/
│   ├── ui/              # Wrong: should be 'lib'
│   │   └── Button/
│   └── index.ts
```

Mix exportable and non-exportable code at the same level
```
// Bad: Mixing concerns
packages/my-package/
├── src/
│   ├── Button/          # Component mixed with...
│   ├── storybook/       # ...non-exportable storybook config
│   └── test-utils/      # ...and test utilities
```

Create deeply nested lib-like structures; keep lib at the top level of src
```
// Bad: Nested lib folders
packages/my-package/
├── src/
│   ├── features/
│   │   └── lib/         # Wrong: lib should be at src level
```

Omit barrels from domain folders within lib
```
// Bad: no barrels — consumers must know individual file paths
packages/my-package/
├── src/
│   ├── lib/
│   │   ├── Button/
│   │   │   ├── Button.tsx
│   │   │   └── types.ts    # No index.ts — fragile imports
│   │   ├── hooks/
│   │   │   └── useToggle.ts # No index.ts
│   │   └── index.ts
```

---

## cs:packaging.naming.single_export_file

Files that contain a single export must be named after that export. This applies to functions, classes, types, constants, and any other single-export module. The file name must match the exported identifier exactly, preserving its casing (camelCase for functions/variables, PascalCase for classes/types/components).

### Do

Name files after the single function they export
```typescript
// isAccepted.ts
export const isAccepted = (status: string): boolean => {
  return status === "accepted";
};

// formatCurrency.ts
export default function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}
```

Name files after the single type or interface they export
```typescript
// ConnectionConfig.ts
export interface ConnectionConfig {
  host: string;
  port: number;
}

// UserRole.ts
export type UserRole = "admin" | "editor" | "viewer";
```

Name files after the single class they export
```typescript
// EventEmitter.ts
export class EventEmitter {
  // ...
}
```

Name files after the single constant they export
```typescript
// DEFAULT_TIMEOUT.ts
export const DEFAULT_TIMEOUT = 5000;
```

### Don't

Use generic names like `helpers.ts`, `utils.ts`, or `types.ts` for files with a single export
```typescript
// helpers.ts — wrong: should be isAccepted.ts
export const isAccepted = (status: string): boolean => {
  return status === "accepted";
};

// utils.ts — wrong: should be formatCurrency.ts
export default function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}
```

Use names that describe the domain instead of the export
```typescript
// validation.ts — wrong: should be isAccepted.ts
export const isAccepted = (status: string): boolean => {
  return status === "accepted";
};

// network.ts — wrong: should be ConnectionConfig.ts
export interface ConnectionConfig {
  host: string;
  port: number;
}
```

---
