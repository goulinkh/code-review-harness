---
name: standards-review
description: Review current changes against project code standards
---

# Standards Review

Review current changes against standards in `docs/code-standards`.

## When to Use

Use this skill when user asks:
- `/standards-review`
- "check standards"
- "review against code standards"
- "does this follow standards?"
- "audit changed code"

## Standards to Load

Read only standards relevant to changed files:
- `docs/code-standards/code.md` — TypeScript code structure, APIs, constants, errors, organization.
- `docs/code-standards/packaging.md` — package metadata, exports, monorepo/app/library structure.
- `docs/code-standards/testing.md` — test layout, coverage, unit/integration test style.
- `docs/code-standards/tsdoc.md` — TSDoc placement and quality.
- `docs/code-standards/git.md` — branch, commit, PR conventions.

## Workflow

1. Inspect changed files:
   - `git status --short`
   - `git diff --staged`
   - `git diff`

2. Map changed files to relevant standards:
   - `package.json`, workspace, exports, bins, app/library layout → `packaging.md`.
   - `*.ts`, `*.tsx` runtime code → `code.md`, `testing.md`.
   - `*.test.ts`, `*.test.tsx`, `vitest.config.*` → `testing.md`.
   - TSDoc/comment changes or exported APIs → `tsdoc.md`.
   - commit/branch/PR docs → `git.md`.

3. Report findings by severity:
   - `must fix` — clear standards violation or likely breakage.
   - `should fix` — standards mismatch with low immediate risk.
   - `ok` — changed area follows relevant standards.

4. For each finding include:
   - file path
   - violated standard id when present, e.g. `cs:testing.file.structure`
   - concrete fix

5. If user asks to fix, edit only files needed for reported violations.

## Output Shape

Use concise markdown:

```markdown
must fix
- path:line — `cs:...` issue. Fix: ...

should fix
- path:line — `cs:...` issue. Fix: ...

ok
- Relevant standards checked: code, packaging, testing, tsdoc, git.
```

If no issues found, say: `No standards issues found.` and list standards checked.
