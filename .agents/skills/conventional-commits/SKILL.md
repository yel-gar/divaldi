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

## Length: a log entry, not a blog post

The subject is one line, under about 72 characters. The whole message, subject plus body,
should fit in roughly **15 lines**. Past that you are writing a document and putting it in the
wrong place.

**The diff already records what changed.** Do not narrate it file by file, do not list which
tests were added, and do not recount your own reasoning process ("I first tried X, but that
failed, so I switched to Y"). Nobody reads that when scanning `git log`, and it is pure noise
in a bisect.

What genuinely earns body space, at most three or four lines:

- **A non-obvious constraint that forced the design**, which the code cannot explain.
- **A deliberate omission or a known gap**, so a future reader does not assume it is an oversight.
- **A gotcha that cost real time**, if it is not already in `.context/LESSONS.md`.

Anything longer belongs in the pull request description, or in
`.context/DECISIONS.md` when it is a decision, or in `.context/LESSONS.md` when it is a trap.
The commit points at that record; it does not duplicate it.

```
# too long -- a changelog, and mostly a re-narration of the diff
test(frontend): raise coverage to 90.24% and enforce a 90% gate

Frontend coverage goes from 67.6% to 90.24% statements across 305 tests,
and coverageThresholds is set to 90 for statements, functions and lines
on the test target in angular.json. The builder enforces it, so no
percentage is hardcoded in the hook or the workflow. Verified to bite: at
statements 90 the run exits 0, at 95 it exits 1. Branches are deliberately
not gated at 84.93%, since the branch figure counts defensive null checks
that carry little signal. The work went into the files with no tests at
all: login page 0% to 100%, order create 0% to 100%, layout 0% to 100%, the
error interceptor 0% to 100%, the attachment upload and download services,
the notification service and both notification components, and the
ControlValueAccessor controls (checkbox, toggle, input, select). The chat
view, previously 42% covered, gained specs for sending, the 2 s polling
loop, its 5-minute timeout, retry, session deletion and the attachment
actions. Three jsdom gaps had to be worked around and are recorded in
LESSONS.md: matchMedia and Element.prototype.scrollTo do not exist and are
both used by the chat component's afterRenderEffect; the polling loop needs
fake timers; and teardown must destroy the fixture before resetting the
TestBed, because onDestroy is what clears the interval. Skipping that
leaves hundreds of queued requests, and flushing them instead throws "Cannot
flush a cancelled request". No production code changed.

# right -- one line of why, and a pointer to where the rest is recorded
test(frontend): enforce a 90% coverage gate in angular.json

The threshold now lives in one place and the builder reads it, so the
hook and workflow name no percentage. The jsdom workarounds needed to test
the chat polling loop are recorded in .context/LESSONS.md.
```

Two more things a commit message is not for: an emoji-led status report, and a summary aimed at
a reviewer who has not opened the diff yet. If the change needs a narrative, open a pull request.

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
