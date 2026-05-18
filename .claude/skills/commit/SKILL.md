---
name: commit
description: Create a standards-compliant git commit for current changes
---

# Commit

Create a git commit from current working tree changes, using project code standards.

## When to Use

Use this skill when user asks:
- `/commit`
- "commit this"
- "create a commit"
- "commit current changes"

## Standards to Load

Before drafting the commit, read:
- `docs/code-standards/git.md` — conventional commit format, scope, branch conventions.
- `docs/code-standards/code.md` — code organization and API standards relevant to changed files.
- `docs/code-standards/packaging.md` — package structure, exports, and monorepo package conventions.
- `docs/code-standards/testing.md` — test file and coverage expectations.
- `docs/code-standards/tsdoc.md` — documentation expectations when changed files include public TypeScript APIs.

## Workflow

1. Inspect git state:
   - `git status --short`
   - `git diff --staged`
   - `git diff`
   - `git log --oneline -5`

2. Check changed files against loaded standards:
   - For package metadata or workspace changes, apply `packaging.md`.
   - For TypeScript runtime code, apply `code.md` and `testing.md`.
   - For public APIs or comments, apply `tsdoc.md`.
   - For commit message, apply `git.md`.

3. If standards violations are visible in changed files, report them before committing. Do not silently commit known violations unless user explicitly directs.

4. Stage only relevant files by explicit path. Never use `git add .` or `git add -A`.

5. Write conventional commit message:
   - Format: `type(scope): description`
   - Description completes: "this commit will ..."
   - Use scope matching package/domain, e.g. `core`, `cli`, `standards`, `workspace`.
   - Prefer `chore(...)` for scaffold/docs/config, `feat(...)` for user-facing capability, `fix(...)` for bug fixes.

6. Commit with heredoc message:

```bash
git commit -m "$(cat <<'EOF'
type(scope): description
EOF
)"
```

7. Verify final state with `git status --short`.

## Hard Rules

- Follow Claude Code git safety protocol.
- Never push unless user explicitly asks.
- Never amend unless user explicitly asks.
- Never bypass hooks with `--no-verify`.
- Never commit secrets, `.env*`, credentials, or copied `.git` metadata.
- If hook fails, fix underlying issue and create a new commit attempt; do not amend previous commit.
