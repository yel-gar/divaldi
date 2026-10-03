---
name: parallel-issues
description: Conventions for running several GitHub issues in parallel with git worktrees and subagents. Use when implementing more than one issue at once, creating or cleaning up worktrees, delegating work to subagents, or merging worker branches back into an integration branch.
---

# Parallel issues with worktrees — divaldi conventions

Each issue gets its own branch and its own `git worktree` outside the main checkout. Workers
never share a working tree, so two agents cannot clobber each other's files.

## The flow

1. Orchestrator creates a branch and a worktree per issue, both off the integration branch.
2. Worker implements the issue, runs the full test suites, and ends its last commit with
   `(closes #NN)`.
3. Worker launches the `reviewer` subagent to review against the integration branch.
4. Worker fixes anything found and reviews again. Nitpicks alone may be dismissed.
5. Worker reports ready for merge.
6. Orchestrator merges one at a time, resolving conflicts.

## Creating a worktree

Keep worktrees **outside** the main checkout. Putting them in a subdirectory of the repo works,
but a stale worktree directory then shows up as an untracked file in every `git status` and can
be committed by accident.

```bash
# one branch and worktree per issue
git worktree add /tmp/divaldi-wt/issue-59 -b issue/59-fix-retry-history feat/ai-refactor
git worktree add /tmp/divaldi-wt/issue-46 -b issue/46-filename-filter feat/ai-refactor
```

Then, per worktree, before any suite will run:

```bash
cd /tmp/divaldi-wt/issue-59
pyenv local 3.14                                          # .python-version is gitignored
poetry -C backend install --with dev --no-root
npm --prefix frontend install                             # only if the frontend is touched
mkdir -p .opencode/agents && cp <repo>/.opencode/agents/reviewer.md .opencode/agents/
cp <repo>/.env .env                                      # only if Compose is started
```

Every one of those exists because the file it prepares is **gitignored** and therefore
invisible to `git worktree`. See the traps below.

## Working inside a worktree

Agents must `cd` into the worktree and stay there. Two traps:

- **Python resolution.** `poetry -C backend` and the venv paths are relative to the CWD, so run
  every gate from inside the worktree. A test run from the main checkout tests the wrong code.
- **`.python-version` is gitignored, so a new worktree has none.** pyenv then falls back to
  whatever is globally selected, which on this machine is 3.13 — and Poetry will happily build a
  venv on the wrong interpreter. Set it per worktree with `pyenv local 3.14`. The file is
  ignored, so this is per-worktree setup and not something a commit can fix.
- **Stale dependencies.** A fresh worktree has no `node_modules` and no installed venv. Run
  `poetry -C backend install --with dev --no-root` and `npm --prefix frontend install` once per
  worktree before the suites. The `--no-root` matters: the backend is consumed as a path
  dependency by the compose build, so Poetry refuses to install it as a package and aborts
  without it. Skipping this fails as `ModuleNotFoundError: No module named 'pytest_asyncio'`,
  which reads like a code error rather than a setup gap.

## Reviewing against the integration branch

From inside the worktree, the three-dot form compares against the merge base, which is what a
reviewer wants: it shows only this issue's changes.

```bash
git diff feat/ai-refactor...HEAD          # what this branch adds
git log feat/ai-refactor..HEAD            # its commits
```

Do not review with `git diff` alone. It compares working tree to index or HEAD and will show
nothing for a committed branch.

## Closing the issue

GitHub closes an issue when a commit message on the **default branch** contains `(closes #NN)`.
The keyword must be in the **final** commit of the branch. If it is on an earlier commit and
later commits follow, the issue stays open. Keep the line in the last commit message, near the
end.

## Merging, one at a time

Wait for every worker to report ready before merging anything. Then, in issue order:

```bash
git checkout feat/ai-refactor
git merge --no-ff issue/59-fix-retry-history
```

`--no-ff` keeps each issue's commits grouped, so `git log` still shows what each one did. Merge
conflicts by hand, then **re-run the full suites before moving to the next branch**: a merge can
break something that neither branch broke alone.

Order matters when two branches touch the same file. Check for overlap first with
`git diff --name-only base...branch`, and merge the smaller change first.

## Cleanup

```bash
git worktree remove /tmp/divaldi-wt/issue-59
git branch -d issue/59-fix-retry-history   # only after the merge landed
```

Remove the worktree **after** the merge is verified, not before. Never `git worktree remove`
with `--force` on a worktree with uncommitted work; that discards the changes without asking.

## Merging `.context/` files

Every worker updates `.context/DECISIONS.md`, `.context/LESSONS.md` and `.context/PROJECT_STATE.md`,
so **those three files will conflict on nearly every parallel batch.** Production code merges
clean when the issues are scoped apart, which is why scoping matters more than resolving.

The conflicts are of two kinds, and they need opposite handling:

- **Additive sections** in `DECISIONS.md` and `LESSONS.md`: both sides are correct and both
  should be kept. Append order does not matter. Take ours, then theirs.
- **Competing values for one fact** in `PROJECT_STATE.md`: test counts, coverage percentages, the
  "Last updated" line. Take the later measurement, and recount rather than trusting either
  branch, because each worker measured against the old base and so under-reports the total.

Never resolve either kind by taking one side whole. `git checkout --ours` on `DECISIONS.md`
silently deletes another issue's reasoning, which is worse than the conflict was.

## Verifying a worker's claim yourself

Reports are not evidence. After merging, re-run the regression tests against the **pre-fix**
version of the changed file to confirm they actually fail:

```bash
git show HEAD~2:backend/app/tasks/api.py > /tmp/opencode/pre.py   # the pre-fix file
cp backend/app/tasks/api.py /tmp/opencode/merged.py             # keep the merged one
cp /tmp/opencode/pre.py backend/app/tasks/api.py
poetry -C backend run pytest tests/test_tasks_api.py -q           # must FAIL
cp /tmp/opencode/merged.py backend/app/tasks/api.py              # always restore
```

Count the failures and check they are the tests that should fail. Zero failures means the tests
do not test anything, and the branch should go back.

## Traps this workflow has hit

- **`git worktree` does not carry gitignored files.** `.opencode/agents/reviewer.md` and
  `opencode.json` are gitignored, so a new worktree has **no reviewer agent** and the review step
  silently cannot run. Copy it in explicitly, or the worker's review is skipped without error:

  ```bash
  mkdir -p /tmp/divaldi-wt/issue-59/.opencode/agents
  cp .opencode/agents/reviewer.md /tmp/divaldi-wt/issue-59/.opencode/agents/
  ```

  This applies to `.env` too, which every gitignored and which the Compose stack needs.
- **Documentation issues collide with the code they describe.** An issue that improves endpoint
  documentation for `chat.py` will conflict with any other issue editing `chat.py`, even though
  the intent is unrelated. When that is likely, either sequence them or scope the documentation
  issue to files no other worker is touching.
- **A worker that reports "done" without running the suites is not done.** Require the actual
  test output before merging. Reviewers cannot see whether the suites ran.
- **Two workers in one worktree defeats the whole flow.** Verify with `git worktree list` that
  each agent has its own before launching, not after.
- **A worker may have no subagent tool at all.** The review step assumes workers can launch
  the `reviewer` agent, and a `general` subagent session often cannot: its tool catalog exposes
  no delegation tool. Ask workers to report explicitly whether the review ran and who performed
  it, so a self-review is never mistaken for an independent one. Do not tell a worker to launch
  a subagent without checking it has one.
- **A gate command you write may itself be wrong.** Importing `app.main` reads the environment at
  import time, so `python -c "from app.main import app"` dies with `KeyError: 'S3_ACCESS_KEY'`
  unless `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `DEBUG`, `FRONTEND_URL` and `BACKEND_URL` are
  exported. A gate that fails for the wrong reason trains workers to ignore gate output.
- **`commitlint` may be unavailable inside a worktree.** The root `package.json` is not installed
  there. `npm install` in the worktree works but churns `package-lock.json`, which then has to be
  reverted. Prefer verifying with `npx --no -- commitlint --last` from the main checkout after the
  merge, and say so in the brief rather than blocking the worker on it.
- **Never remove a Docker volume as part of this workflow.** Running the full suites means
  starting containers; do not add `docker compose down -v` or any prune to a cleanup step. See
  `AGENTS.md` rule 6.
