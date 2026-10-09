# Project state

Rewritten in place on each update. Do not append. Keep it short and current; detail belongs
in `DECISIONS.md` (rationale) or `AGENTS.md` (procedure).

Last updated: **2026-10-03** (issues #47 and #51 merged)

---

## Current status

Everything described below is working and running via Docker Compose.

| Component | State |
|---|---|
| `backend/` | Complete: auth, users, admin, chat, files, TaskIQ workers, Alembic, GigaChat harness |
| `processing/` | Complete: PDF rasteriser, DXF parser, Excel calculator, with tests |
| `frontend/` | Complete: login, order create, chat with polling, history, profile, settings, admin users |
| Infra | 13 Compose services, dev and memory-limit overrides, healthcheck-gated startup |

**Backend.** FastAPI on Python 3.14. Cookie auth (argon2), admin with account expiry, chat
sessions with async generation, attachment upload and confirm, presigned S3 results.
Alembic has a single revision (`58cdf8dfcbba`, initial). Twelve TaskIQ tasks across the
`default` and `network` queues, with hourly and 10-minute cleanup crons.

**Processing.** `pymupdf` PDF to PNG at 150 DPI, hand-rolled DXF measurement parser, and an
`openpyxl` commercial-offer template filler using the shop's production norms.

**Frontend.** Angular 21.2 standalone with signals. Reactive forms, cookie auth, 2-second
polling for generation results, inline preview for PDF, image, docx and xlsx, light/dark
theme, admin user management. 20 colocated `*.spec.ts` files.

**Not started or placeholder.** The profile page body, the settings page body, and three
admin sections (`Журнал действий`, `Настройки`, `О системе`) render `SectionPlaceholder`.

**No LICENSE file exists.** The repository is treated as proprietary.

---

## Database

One migration, eight tables (`users`, `chat_sessions`, `sessions`, `chat_messages`,
`attachments`, `generation_results`, `processing_results`,
`processing_result_uploadables`) and two enums (`userrole`, `generationresulttype`). The
TaskIQ dashboard keeps its own separate `taskiq_dashboard` database on the same PostgreSQL
instance, created by `conf/postgres-init/01-taskiq-dashboard.sql`.

---

## Test coverage

| Suite | Command | Notes |
|---|---|---|
| Backend | `poetry -C backend run pytest` | 349 tests; needs a Docker daemon |
| Backend coverage | `poetry -C backend run pytest --cov` | **98.83%**, gated at 90% by `fail_under` |
| Processing | `poetry -C processing run pytest -v` | 85 tests; DXF, PDF, calculator; pure, no Docker |
| Processing coverage | `poetry -C processing run pytest --cov` | **95.73%**, gated at 90% by `fail_under` |
| Frontend | `npm --prefix frontend test` | Vitest, 330 tests; runs in `frontend-ci.yml` |
| Frontend coverage | `npx ng test --coverage` | 90.47% stmts, 85.36% branches, 90.71% funcs; gated at 90% |

**Backend coverage is enforced at 90%** via `fail_under` in `backend/pyproject.toml`,
reading **98.83%** across 349 tests with branch coverage. The `pre-push` hook and
`.github/workflows/backend-coverage.yml` enforce it and neither names a percentage.

**Frontend coverage is enforced at 90%** via `coverageThresholds` on the `test` target in
`frontend/angular.json`, reading **90.47%** statements across 330 tests. That is only just
above the line; branches (85.22%) are deliberately not gated.

**All three Python and TypeScript suites are now gated at 90%**, each with its threshold in
exactly one place. Processing reads **95.73%** across 85 tests with branch coverage; the 15
uncovered statements in `dxf_parser.py` are provably unreachable and documented as such in
`processing/pyproject.toml`, so that figure will not creep upward without a real change.

PostgreSQL, Redis and Garage are real testcontainers on the backend. The LLM is faked by
`app/providers/mock.py`, selected with `SBER_API_KEY=mock` and switchable via
`MOCK_PROVIDER_MODE`; the real GigaChat is only reachable through `@pytest.mark.live`
tests, which are deselected by default.

**The frontend suite is GREEN.** 330 of 330 tests pass across 33 spec files, up from 154.
It was red on `main`: 14 tests in `sidebar.component.spec.ts` failed because the jsdom test
environment exposes no `localStorage`, and `ThemeService` reads it in a field initializer.
Fixed by `src/test-setup.ts`, registered through the builder's `setupFiles` option. The
`vitest-coverage` pre-push hook now passes for everyone.

---

## CI

| Workflow | Runs |
|---|---|
| `e2e.yml` | Playwright against the Compose stack, `SBER_API_KEY=mock` (23 tests) |
| Isolation | e2e runs under Compose project `divaldi-e2e`, so its volumes are `divaldi-e2e_*` and never the developer's |
| `processing-coverage.yml` | processing `pytest --cov`, enforces `fail_under` |
| `backend-ci.yml` | black, ruff, pytest (Python 3.14) |
| `backend-coverage.yml` | pytest with coverage, uploads `coverage.json` (reporting only) |
| `processing-ci.yml` | black, ruff, pytest |
| `frontend-ci.yml` | `ng lint`, `npx ng test --watch=false`, `ng build --configuration production` (Node 22) |
| `commitlint.yml` | Conventional Commits on push and PR |
| `pre-commit.yml` | generic yaml, json, toml, eof and whitespace checks |

There is no deploy workflow; CI only.

---

## Current work

**Branch `issue/51-chat-pagination` (from `feat/ai-refactor`)** — `GET /chats/` is
paginated. The response is now `{items, total, page, items_per_page}` with `page`,
`items_per_page`, `sort` and `order` query parameters, so the change is breaking for
every consumer: `ChatService.list()` takes a `ChatListQuery`, the history page pages and
sorts server-side behind a pager, and the sidebar asks for a 10-item preview. 9 new
backend tests and 9 new frontend tests; see "Chat list pagination" in `DECISIONS.md`.
**Message pagination is not included** and `GET /chats/{id}` is unchanged; the reasoning
is in that same section.

**Branch `issue/46-filename-filter` (from `feat/ai-refactor`)** — the chat upload route
(`POST /chats/{id}/uploads`) now rejects a filename that is not a bare name with an
allowlisted extension (`.pdf`, `.dxf`, `.png`, `.jpg`, `.jpeg`), alongside the existing
content-type and size checks. 17 tests added; see the "Attachment filename filtering"
section in `DECISIONS.md`.

**Branch `docs/agent-harness` (from `main`)** — documentation, agent harness, and the
backend and frontend coverage pipelines:

- `README.md` rewritten with a product description, features, an architecture diagram, the
  request lifecycle, the stack, ports, quick start, dev setup, security notes and code
  owners. The original environment-variable table is preserved and `TEST_INSTANCE_MODE` is
  now documented.
- `README.ru.md` added as a full Russian translation, cross-linked in both directions.
- `AGENTS.md` created: a mandatory harness with the non-negotiable rules (poetry add, npm
  install, Docker-only runs, local tests), conventions per package, quality gates, the
  `.context/` contract, and a pre-submission checklist.
- `.context/` created with `DECISIONS.md`, `LESSONS.md` and `PROJECT_STATE.md`.
- `.agents/skills/` created with eight task-specific playbooks.
- Backend coverage pipeline: `pytest-cov` added to the `dev` group, `[tool.coverage.*]`
  config in `backend/pyproject.toml`, a `pre-push` pre-commit hook, and
  `.github/workflows/backend-coverage.yml`.
- Backend coverage raised from 49.55% to **98.79%** and gated at 90% (`fail_under = 90`).
  Added `app/providers/mock.py`, an offline `AIClient` selected by `SBER_API_KEY=mock` and
  switchable with `MOCK_PROVIDER_MODE`; real PostgreSQL, Redis and Garage testcontainers;
  ~275 new tests across the chat routes, both worker modules, the providers, and the
  user/admin routes; and `@pytest.mark.live` tests for the real GigaChat, deselected by
  default via `addopts = "-m 'not live'"`.
- Frontend coverage pipeline: `@vitest/coverage-v8@4.1.11` added as a dev dependency,
  native `coverage` options on the `test` target in `angular.json`, a `vitest-coverage`
  pre-push hook, and `.github/workflows/frontend-coverage.yml`. The gate is
  `coverageThresholds` on that same target.
- **Object storage migrated from MinIO to Garage.** MinIO was deleted from Docker Hub and
  locked down on quay.io, so its image became unpullable and backend CI failed in
  `test_tasks_files.py`. Garage is S3-compatible, so `app/storage.py` only changed to rename
  `MINIO_*` to `S3_*`; the work was Compose plumbing. New: `conf/garage.toml`,
  `conf/garage-init.sh`, `conf/garage.Dockerfile`, `conf/garage-rules/` and
  `backend/apply_s3_config.py`. `conf/minio-init.sh` and `conf/minio-rules/` are gone and the
  buckets are still `avatars` and `uploads` with the same three expirations. Both buckets, a
  presigned POST upload and a presigned GET were verified against the running stack, and the
  10 e2e specs pass unchanged.
- **Processing coverage gated**: `pytest-cov` added to the `dev` group, `fail_under = 90`
  plus `[tool.coverage.*]` in `processing/pyproject.toml`, a `pytest-coverage-processing`
  pre-push hook, and `.github/workflows/processing-coverage.yml`. Coverage went from 86% to
  **95.73%** with branch coverage, tests from 50 to 85. The three new specs target
  `get_measurements_data`'s ARC and LWPOLYLINE branches (a second walker over the same
  entities that `extract_measurements` tests never touched), `_load_material_prices`'s
  unparseable-value and uncached-formula paths, and the PDF converter's zero-page document.
- **Commit message length capped at ~15 lines** in `AGENTS.md` and the
  `conventional-commits` skill, with a worked too-long example, after three commits in this
  branch ran twenty lines of body each.
- **End-to-end suite added**: Playwright in `e2e/`, driving the real Compose stack with
  `SBER_API_KEY=mock`. 10 specs covering authentication, the request-to-offer journey
  (including the generated `kp.xlsx` in the results panel), a follow-up message, the
  history list, and the admin user management. `docker-compose.override.yml.e2e` moves the
  frontend to port 18080 and forces the offline provider; `e2e/scripts/setup.sh` brings the
  stack up, seeds an `e2e` superuser and clears rate limits. Runs in
  `.github/workflows/e2e.yml`.
- Frontend coverage raised from 67.6% to **90.24%** and gated at 90%
  (`coverageThresholds` in `angular.json`). Added 151 tests: login page, order create,
  upload/download services, error interceptor, the checkbox, toggle, input and select
  ControlValueAccessor controls, the notification components, layout, and the chat view's
  send, polling, retry, delete and attachment behaviour. Suite is now 305 tests in 33 files.

- Frontend test fix: `src/test-setup.ts` added and registered via `setupFiles`, supplying
  the `localStorage` / `sessionStorage` the jsdom test environment lacks. This unblocked
  14 red tests in `sidebar.component.spec.ts` and took the suite to 154/154 green.

---

## Bug fixes landed since the last rewrite

- **Uploads and downloads from the browser failed with `403 This CORS request is not allowed.`**
  The MinIO-to-Garage migration left the buckets with no CORS configuration. MinIO allowed `*` by
  default; Garage has no default and rejects any preflight that matches no rule, which broke
  every transfer made through a presigned URL. `backend/apply_s3_config.py` (renamed from
  `apply_s3_lifecycle.py`, service `garage-lifecycle` to `garage-config`) now sets bucket CORS
  from `S3_CORS_ORIGINS` alongside the expiration rules. Nothing caught it earlier: the backend
  suite never performs a preflight and both presigned calls succeed server-side.
- **#59, retry resent the assistant's own message.** `process_response` persists the reply as a
  `ChatMessage`, so the session's last row after an error was the answer being retried, and it
  went back to the provider. `generate_chat_message` now cuts the history after the last user
  message. See `DECISIONS.md`, "Provider history ends at the last user message".

---

## Roadmap

Ordered by value, not by commitment:

- **Paginate `GET /chats/{id}` (messages).** Left out of #51 on purpose. The chat view
  merges the transcript with a 2 s poll and with local pending messages, so this needs a
  cursor or a scroll-preserving "older messages" control rather than a plain offset.

0. **Mirror the Garage image into a registry we control** and pin it by digest. MinIO's
   deletion cost a CI outage and this migration; the same event could happen to
   `dxflrs/garage`. Roughly an hour, and it is the only fix that addresses the cause rather
   than the instance.

1. **Extend the e2e suite.** 23 specs cover authentication, the request-to-offer journey, a
   follow-up message, attachment upload and delete, the paginated history list, and admin
   user management including role tiers. Not yet covered: the docx/xlsx preview, avatar
   upload, the theme toggle, and the error paths (a generation that fails, a session that was
   deleted).
2. **Fill the placeholder sections:** profile, settings, and the admin action log
   (`Журнал действий`) and system info.
3. **Action log.** The admin nav links to it but nothing backs it; the database has no audit
   table yet.
4. **Sweep the dead root `parser/` directory.** Only `__pycache__` remains. This needs a
   maintainer decision, not an agent's.
5. **Add a LICENSE file**, currently absent.
6. **Document `TEST_INSTANCE_MODE` in `.env.example`.** It exists in compose and in the code,
   but not in the example env file.
7. **Consolidate the coverage CI workflows.** `frontend-coverage.yml`,
   `backend-coverage.yml` and `processing-coverage.yml` each run their package's full suite,
   and each package also has a plain `*-ci.yml` that runs the same tests. A PR touching the
   frontend therefore pays for the Vitest suite twice. Making each coverage job depend on its
   CI job would halve that. Not urgent while the suites are fast.
8. **Add a per-test e2e user.** The suite currently shares one seeded user and works
   around the 5-per-minute rate limit by clearing Redis between tests. Giving each worker
   its own user would be cleaner, at the cost of a provisioning step per test.

---

## Known issues

- `TEST_INSTANCE_MODE` is absent from `.env.example`, so a developer must read the compose
  file or the backend source to learn it exists.
- The frontend dev override bind-mounts `./frontend` over `/app`. If `node_modules` inside it
  is stale or partially populated, `ng serve` fails in ways that look like source errors.
- Frontend statement coverage (90.29%) sits almost exactly on the 90% gate. Any new
  uncovered component will fail CI, and branches at 85.22% have no headroom.
- **The object-storage image is still a single point of failure.** `dxflrs/garage` lives in
  one small project's Docker Hub namespace; MinIO died the same way. Mirroring the image into
  an organisation-controlled registry and pinning it by digest would make an upstream deletion
  a non-event. Not done: it needs write access to a registry this project does not own yet.

---

## In flight: issue #47, attachment listing and deletion (branch `issue/47`)

Appended rather than folded into the sections above, because several branches are being
merged in parallel and this file is normally rewritten in place.

- `GET /chats/{session_id}/attachments` lists every attachment row of a session with its
  Redis upload status, `ready` flag and `chat_message_id`, so a client can show the files a
  session is currently holding rather than only the ones a message references.
- `DELETE /chats/{session_id}/attachments/{attachment_id}` removes the row, the stored
  object, the per-page artifacts of a PDF, and the cached status, URL, ownership and PDF-sync
  keys. Best effort on storage: an object that already expired does not keep the row.
- Frontend: `ChatService.attachments` / `deleteAttachment`, an `onAttachmentId` callback on
  the upload observable, a real delete behind the trash button in the uploader list, and a
  "Загруженные файлы" section in the results panel with a per-file status label plus preview,
  download and delete. No new component, so no new file for the coverage gate to count at 0%.
- 12 backend tests and 16 frontend tests added; backend is 345 tests at **98.83%**, frontend
  is 321 tests at **90.43%** statements, 85.06% branches, 90.64% functions.
- **Not fixed, reported instead:** `cleanup_orphan_attachments` in `app/tasks/files.py`
  iterates an already exhausted `ScalarResult`, so it logs `count=0` and never deletes an S3
  object. Rows are still deleted; the objects fall to the 7-day lifecycle rule. See
  `LESSONS.md`.
