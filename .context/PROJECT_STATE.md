# Project state

Rewritten in place on each update. Do not append. Keep it short and current; detail belongs
in `DECISIONS.md` (rationale) or `AGENTS.md` (procedure).

Last updated: **2026-09-29** (coverage pipeline added)

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
sessions with async generation, attachment upload and confirm, presigned MinIO results.
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
| Backend | `poetry -C backend run pytest` | auth, admin, migrations; needs a Docker daemon |
| Backend coverage | `poetry -C backend run pytest --cov` | 33 tests, **49.55%** (branch coverage on) |
| Processing | `poetry -C processing run pytest -v` | DXF, PDF, calculator; pure, no Docker |
| Frontend | `npm --prefix frontend test` | Vitest; **not run in CI** |

**Coverage is reported, not enforced.** `fail_under = 0` in `backend/pyproject.toml`.
Reported by a `pre-push` hook and by `.github/workflows/backend-coverage.yml`. Raising
`fail_under` to 90 is the single change needed to make it a gate, and it was verified to
exit 1 when set that way.

**Known gap:** no tests cover the chat routes, the file upload and confirm flow, or any
TaskIQ worker. The coverage report quantifies it: `routes/chat.py` 24%, `tasks/files.py`
15%, `tasks/api.py` 17%, `routes/users.py` 34%, `providers/sber.py` 28%. Those are the
highest-risk areas and the natural place to add coverage next.

---

## CI

| Workflow | Runs |
|---|---|
| `backend-ci.yml` | black, ruff, pytest (Python 3.14) |
| `backend-coverage.yml` | pytest with coverage, uploads `coverage.json` (reporting only) |
| `processing-ci.yml` | black, ruff, pytest |
| `frontend-ci.yml` | `ng lint`, `ng build --configuration production` (Node 22) |
| `commitlint.yml` | Conventional Commits on push and PR |
| `pre-commit.yml` | generic yaml, json, toml, eof and whitespace checks |

There is no deploy workflow; CI only.

---

## Current work

**Branch `docs/agent-harness` (from `main`)** — documentation, agent harness, and the
backend coverage pipeline:

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
  `.github/workflows/backend-coverage.yml`. Reporting only, `fail_under = 0`.

No runtime code was touched.

---

## Roadmap

Ordered by value, not by commitment:

1. **Cover the chat and file flow.** The async generation path, the upload confirm
   handshake, `TEST_INSTANCE_MODE` guarding and at least one worker have no tests. This is
   also the work that moves coverage from 49.55% toward a 90% gate.
2. **Fill the placeholder sections:** profile, settings, and the admin action log
   (`Журнал действий`) and system info.
3. **Action log.** The admin nav links to it but nothing backs it; the database has no audit
   table yet.
4. **Sweep the dead root `parser/` directory.** Only `__pycache__` remains. This needs a
   maintainer decision, not an agent's.
5. **Add a LICENSE file**, currently absent.
6. **Document `TEST_INSTANCE_MODE` in `.env.example`.** It exists in compose and in the code,
   but not in the example env file.

---

## Known issues

- Frontend specs exist (20 files) but **never run in CI**, so a regression can merge green.
- `TEST_INSTANCE_MODE` is absent from `.env.example`, so a developer must read the compose
  file or the backend source to learn it exists.
- Backend test coverage is limited to auth, admin and migrations; the chat and file pipelines
  are exercised only manually.
- The frontend dev override bind-mounts `./frontend` over `/app`. If `node_modules` inside it
  is stale or partially populated, `ng serve` fails in ways that look like source errors.
