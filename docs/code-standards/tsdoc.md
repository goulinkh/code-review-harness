# TSDoc Standards

Standards for tsdoc development.

## cs:tsdoc.documentation_layers

File-level and export-level TSDoc serve fundamentally different purposes. Export-level documentation describes *what the symbol does* — its API contract, parameters, return semantics, and side effects. File-level documentation describes *why this module exists* — its architectural role, the design invariants it upholds, and how its exports relate to each other. In single-export files the file exists solely to house that export, so file-level documentation is redundant; document only the exported symbol. In multi-export files, a file-level block is warranted when it explains the cohesion principle that binds the exports together — the reason they live in one file rather than separate ones.

### Do

In single-export files, document only at the export level — the API contract belongs on the symbol.
```typescript
// resolveDefinition.ts — single export, no file-level block needed
/** Resolve definition locations for a CSS custom property. */
export default function resolveDefinition(cssVar: string, graph: TokenGraph) {
  // ...
}
```

In multi-export files, use a file-level block to explain the module's architectural purpose — why these exports are grouped.
```typescript
// types.ts — multiple exports, file-level explains cohesion
/**
 * Shared types for diagnostic rule modules.
 *
 * Each diagnostic check receives one of these context objects,
 * ensuring a uniform interface across per-usage and file-level rules.
 */

export interface UsageRuleContext { /* ... */ }
export interface FileRuleContext { /* ... */ }
```

Use export-level TSDoc to describe the API contract: what the symbol does, its parameters, return value, and any side effects.
```typescript
/**
 * Check: css/missing-fallback — var() without a fallback on an unregistered property.
 *
 * Pushes a diagnostic when a var() usage has no fallback and the property
 * is not registered via @property.
 */
export default function checkMissingFallback(ctx: UsageRuleContext, results: Diagnostic[]) {
  // ...
}
```

### Don't

Add a file-level block in a single-export file that restates what the export-level doc already says.
```typescript
// Bad: file-level repeats the export's own description
/** Resolve definitions for CSS custom property usages. */

/** Resolve definitions for CSS custom property usages. */
export default function resolveDefinition() { /* ... */ }
```

Use file-level docs to describe *what* an export does — that belongs on the export itself.
```typescript
// Bad: file-level describes the function instead of the module's role
/** Build a completion item for a CSS variable. */

export default function buildCompletionItem(name: string) { /* ... */ }
```

Omit file-level docs on multi-export modules where the grouping rationale is non-obvious.
```typescript
// Bad: reader cannot tell why these live together
export function isCompletionRequest(req: WorkerRequest) { /* ... */ }
export function isHoverRequest(req: WorkerRequest) { /* ... */ }
export function isDiagnosticsRequest(req: WorkerRequest) { /* ... */ }
```

---

## cs:tsdoc.module_tag_location

The `@module` TSDoc tag must appear only on barrel files such as `index.ts`. Ordinary source files must document their exported API directly and must not use file-level `@module` tags.

### Do

Use `@module` on a barrel file that defines a package or folder-level API.
```typescript
/**
 * Public protocol API.
 * @module protocol
 */
export { createRequest, matchResponse } from './index.js';
```

Document an ordinary source file at the exported symbol instead of using `@module`.
```typescript
/** Build a completion item for a CSS variable. */
export default function buildCompletionItem(name: string) {
  // ...
}
```

### Don't

Add `@module` to a single-purpose implementation file.
```typescript
/**
 * Build a completion item.
 * @module providers/completions/buildCompletionItem
 */
export default function buildCompletionItem(name: string) {
  // ...
}
```

Use file-level `@module` tags as a substitute for export documentation.
```typescript
/** @module helpers/formatCurrency */
export default function formatCurrency(value: number) {
  return `$${value}`;
}
```

---

## cs:tsdoc.self_contained

TSDoc comments must be self-contained — a reader should fully understand the documented symbol from its comment alone. External links (public specs, RFCs, GitHub issues) are allowed as supplementary references, but the comment itself must never depend on them for comprehension. If an external concept drives the implementation, distill the essential information into the comment.

### Do

Explain the concept inline so the reader needs nothing else
```typescript
/**
 * Encode a string as a percent-encoded URI component.
 *
 * Replaces every character that is not an unreserved character
 * (A-Z, a-z, 0-9, `-`, `.`, `_`, `~`) with its UTF-8 percent-encoded form.
 */
export function encodeComponent(value: string): string {
  // ...
}
```

Add an external link as a supplementary reference after a self-sufficient explanation
```typescript
/**
 * Compare two semantic version strings.
 *
 * Compares major, minor, and patch numerically in that order.
 * Returns a negative number if `a < b`, zero if equal, or a positive number if `a > b`.
 * Pre-release versions (e.g. `1.0.0-alpha`) sort before their release counterpart.
 *
 * @see https://semver.org
 */
export function compareVersions(a: string, b: string): number {
  // ...
}
```

Reference a GitHub issue for additional context when the comment already explains the behaviour
```typescript
/**
 * Truncate session tokens to 64 characters before storage.
 *
 * Tokens longer than 64 characters exceed the column width in the
 * sessions table and would be silently truncated by the database,
 * so we enforce the limit explicitly.
 *
 * @see https://github.com/acme/backend/issues/412
 */
export function truncateToken(token: string): string {
  // ...
}
```

### Don't

Point the reader to an external resource instead of explaining the behaviour
```typescript
/**
 * Encode a URI component.
 *
 * Implements RFC 3986 §2.1.
 * @see https://datatracker.ietf.org/doc/html/rfc3986#section-2.1
 */
export function encodeComponent(value: string): string {
  // ...
}
```

Reference a wiki or internal doc as a substitute for inline explanation
```typescript
/**
 * Truncate session tokens before storage.
 *
 * See the security review document for rationale:
 * https://wiki.internal/security/session-token-length
 */
export function truncateToken(token: string): string {
  // ...
}
```

Leave the reader unable to understand the symbol without following a link
```typescript
/**
 * Compare two semantic version strings.
 *
 * @see https://semver.org for the full specification.
 */
export function compareVersions(a: string, b: string): number {
  // ...
}
```

---
