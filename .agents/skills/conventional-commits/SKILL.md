---
name: conventional-commits
description: Conventions for commit messages, commit types and scopes, and branch naming in the divaldi repository. Use when writing a commit message, preparing a PR description, or choosing a branch name.
---

# Conventional Commits — divaldi conventions

Enforced mechanically by `commitlint.config.js`:

```js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

The `commit-msg` pre-commit hook runs `npx --no -- commitlint --edit`, and
`.github/workflows/commitlint.yml` re-checks pushes and pull requests. A non-conforming
message blocks the commit locally and fails CI remotely.

## Format

```
<type>(<optional scope>): <subject>
```

- Type and scope lowercase.
- Subject in the imperative mood, lowercase, no trailing period.
- Subject line under roughly 72 characters; wrap the body at 72.

## Types

| Type | Use for |
|---|---|
| `feat` | a new capability |
| `fix` | a bug fix |
| `refactor` | behaviour-preserving restructuring |
| `perf` | performance work |
| `docs` | documentation only |
| `test` | tests only |
| `build` | dependencies, build system |
| `ci` | workflows, pre-commit, lint config |
| `chore` | housekeeping with no source effect |
| `revert` | reverting a previous commit |

## Scopes

Observed in this repository's history: `backend`, `frontend`, `processing`, `ci`. Use the
top-level package name, not a module name, unless a module is genuinely independent.

## Examples drawn from real history

```
feat: db migrations
feat(backend): add pagination and password set for admin
fix(backend): migration scripts improvement + proper url creation
fix(frontend): sliding active-pill indicator for xlsx sheet tabs
docs: add missing npm install instruction to dev setup
ci(backend): pre-commits checks
ci!: temporarily remove minio from images
refactor(processing): extract shared parsing helpers
test(backend): cover TEST_INSTANCE_MODE guards
```

## Breaking changes

Mark with `!` after the type or scope, and add a footer:

```
refactor(api)!: remove the legacy parser endpoint

Superseded by processing.parser. Callers must migrate to
POST /api/v1/chats/{id}/messages.
```

## Good subjects

State what changed and where. "fix: bug in upload" is useless three weeks later.

```
fix(backend): release the chats:global lock when generation times out
feat(frontend): show per-position hours in the results panel
fix(processing): handle DXF POLYLINE with closed flag
```

## Branch naming

Prefixes in use: `jut/`, `feat/`, `fix/`, `docs/`, `feature/`.

```
jut/backend-admin
jut/frontend-2.1-ui-embellishments
feat/attachment-preview
docs/agent-harness
```

## No commit metadata beyond the message

The message is the only metadata allowed. Do not add these, and do not let a tool add them on
your behalf:

- `Co-Authored-By:` or any other attribution trailer
- `Generated with ...` style footers, with or without a robot emoji
- Signed-off-by, Reviewed-by, or any other `git interpret-trailers` entry
- `--author` or `--trailer` flags on `git commit`
- `git commit --amend` used to inject attribution

```bash
# wrong
git commit -m "feat(backend): add kp export" --trailer "Co-Authored-By: Bot <bot@example.com>"

# right
git commit -m "feat(backend): add kp export"
```

Authorship and history already live in git: the commit author, the branch, the PR link. If a
template, hook or assistant proposes appending attribution, drop it. Commitlint validates the
message only, so this is not machine-enforced; it is a rule you follow.

## Checks

```bash
npm run commitlint              # edit message interactively
npx commitlint --last --verbose # validate the last commit
npx --no -- commitlint --from <base> --to <head> --verbose
```

The root `package.json` must be installed (`npm install`) for commitlint to be available; the
`npx --no --` prefix in the hook prevents npm from fetching it from the network.

## Note

The pre-commit hooks for Python **never fail the commit**, because
`scripts/precommit-*.py` pass `check=False`. Commitlint is the exception: it does block. Do
not rely on a clean hook run to mean the rest of the gates passed; run `black --check`,
`ruff check` and `pytest` explicitly.
