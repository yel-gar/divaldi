---
name: e2e-playwright
description: Conventions for the Playwright end-to-end suite in divaldi. Use when writing or debugging a spec under e2e/tests/, changing the e2e stack override, or adding a CI step that drives the Compose stack.
---

# E2E with Playwright — divaldi conventions

The suite in `e2e/` drives the **real Compose stack** — Angular behind nginx, FastAPI,
both TaskIQ worker pools, PostgreSQL, Redis, Garage — with `SBER_API_KEY=mock`. Only the
LLM is replaced, by the same `MockProvider` the unit suite uses. A request therefore still
walks the router, the worker, the spreadsheet calculator and a real S3 round trip.

## Running

```bash
./e2e/scripts/run.sh        # bring the stack up, seed it, run the suite
./e2e/scripts/setup.sh      # stack and seed only
cd e2e && npx playwright test --ui
```

The stack comes up on port **18080** so it never collides with a running dev stack. Override
with `E2E_BASE_URL`.

## Isolation: the project name is load-bearing

`setup.sh` runs `docker compose -p divaldi-e2e -f docker-compose.yaml -f
docker-compose.override.yml.e2e`. Neither half is cosmetic:

- **The project name isolates the volumes.** Compose prefixes named volumes with it, so
  the default project name resolves to `divaldi_postgres_data` — the developer's own
  database. Before this was fixed the suite had written 13 users and 278 seeded chat
  sessions into it. Volume names cannot be overridden per service, so the project name is
  the only lever.
- **Naming the override with `-f` leaves the developer's `docker-compose.override.yml`
  alone.** It used to be copied over that file, which meant any later `docker compose`
  command in the repo picked up the e2e ports and recreated the developer's containers
  with them. The dev frontend ended up holding both 8080 and 18080.

Anything that shells out to Docker — `clearRateLimits` in `helpers.ts`, the SQL seeder in
`history-pagination.spec.ts` — must repeat both `-p` and the two `-f` flags, or it silently
operates on the dev stack. Both throw if `E2E_PROJECT` is `divaldi` or empty.

The frontend port in `docker-compose.override.yml.e2e` uses `ports: !override`, not a plain
list. Compose **merges** a service's ports across files, so a plain list leaves the base
file's 8080 binding in place and the container cannot start whenever a dev stack holds it.

## The two rules that will break your test

**1. The backend rate-limits chat creation and message sending to 5 per minute per user**
(`chats:post` in `app/routes/chat.py`). The whole suite runs as one seeded user, so it
trips its own limiter. Two defences are already in place, and a new chat-creating test
depends on both:

- `workers: 1` in `playwright.config.ts` — parallel workers trip each other.
- an auto fixture in `tests/helpers.ts` that clears `ratelimit:*` in Redis before each test.

The symptom is misleading: the chat is created (202), the send is rejected (429), the
create page never navigates, and the assertion reports `expected URL to match /chats/.+`
with no mention of a rate limit. If a chat-creating test fails on navigation, check the
backend log for 429 before debugging the test.

**2. The mock provider names every chat identically** (`Расчёт КП (mock)`), because
`chat_name` comes from the generated payload. Identify a session by the id in the URL:

```typescript
const sessionId = new URL(page.url()).pathname.split('/').pop();
```

## Writing a spec

```typescript
import { expect, login, test } from './helpers';

test('does the thing', async ({ page }) => {
  await login(page);
  // ...
});
```

`helpers.ts` re-exports `test` and `expect`; import them from there, not from
`@playwright/test`, so the rate-limit fixture applies.

### Locating elements

- **Icon-only buttons have an `aria-label`.** Use
  `getByRole('button', { name: 'Панель результатов расчёта' })`, not a visible-text guess.
- **`app-input` renders a hidden input and a textarea**, so `getByPlaceholder` resolves to
  two elements and trips strict mode. Target `textarea[placeholder="..."]`.
- **User-facing errors are toasts**, not inline field errors. A failed login raises a
  notification; there is no `.auth-error` element.
- **The brand mark is a `div`, not a heading.** `page.locator('.h1:has-text("Divaldi")')`.
- Incoming chat messages carry the author label `Агент`.

### Native dialogs

The admin delete flow uses `window.confirm`, which is not a DOM element:

```typescript
page.once('dialog', (dialog) => dialog.accept());
await row.getByRole('button', { name: 'Удалить' }).click();
```

### Admin specifics

The user form lives in a slide-over panel that starts closed. The `Новый пользователь`
header button opens it for creation, a row action opens it for editing, and it switches
between the headings `Новый пользователь` and `Редактирование пользователя`. Its submit
button reads `Сохранить` in both modes. Open the panel before asserting on any field
inside it: the controls exist in the DOM while closed, so a visibility assertion fails
and a count assertion passes vacuously.

## Readiness must include the API

`setup.sh` used to wait only for nginx to serve `/`. That proves the bundle was
served, not that the backend was up, so on a cold start the first spec logged in
against an API that was still starting and failed as "the app stayed on the login
page" — a symptom that points at auth, not at startup. It now also waits for
`/api/v1/users/me` to answer **401**, which means the routes are loaded.

A readiness probe that only proves the thing you already know is fine is not a
probe. Check the dependency the first test actually needs.

## Seeding a large dataset

The history pager only renders above `CHATS_PAGE_SIZE` rows, and chat creation is rate limited
to 5 per minute with a real generation queued behind each one. Creating 20+ sessions through the
UI is not viable, so `history-pagination.spec.ts` inserts them straight into PostgreSQL:

```typescript
execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'divaldi', '-d', 'divaldi', '-v', 'ON_ERROR_STOP=1', '-c', sql], { cwd: REPO_ROOT, stdio: 'ignore' });
```

Two things about that SQL:

- **Enum values are uppercase.** `chat_messages.role` is a Postgres enum holding `USER`,
  `ASSISTANT`, `SYSTEM`, while the Python side uses a `StrEnum` with lowercase members. `'user'`
  fails with `invalid input value for enum userrole`.
- **Capture the generated `session_id` with `RETURNING`.** Looking the session back up by name
  picks an arbitrary one when several share it, so the message lands in the wrong session.

Seeding this way is fine for e2e because the suite owns the stack. It is not fine for a unit test.

## Traps that cost time here

- **`login()` lands on `/create`, not in a chat.** Anything living only on the chat view — the
  results panel, the attachment list — needs `createChat()` first, or every locator times out on
  a page that does not exist there.
- **The chat's dropzone is given no `inputId`,** so its hidden file input has no id to target.
  Drive it through `page.waitForEvent('filechooser')` on the "Прикрепить файл" button instead.
- **The Playwright `request` fixture has its own cookie jar** and does not see the session cookie
  that `login()` set. For an authenticated API call, either use
  `browser.newContext({ storageState: await page.context().storageState() })`, or assert through
  the page instead.
- **The sidebar and the history page both call `list()`.** Match a request by `items_per_page`
  to tell them apart; catching the first `/chats/` request usually catches the sidebar's 10-row
  preview and yields a baffling `Expected "20", Received "10"`.
- **"Пользователь" is both a role option and the select's placeholder,** so
  `getByRole('option', { name: 'Пользователь' })` trips strict mode. Scope to
  `getByRole('listbox').getByRole('option')`.

## Waiting

Generation is asynchronous: the frontend polls the result every 2 s. Give agent-dependent
assertions a generous timeout:

```typescript
await expect(page.getByText('kp.xlsx')).toBeVisible({ timeout: 45_000 });
```

## The seeded user

`setup.sh` creates (or resets) a superuser, `e2e` / `e2epassword` by default, via
`docker compose exec`. Override with `E2E_USERNAME` and `E2E_PASSWORD`, which the specs
read from the environment.

## Environment quirks

- `import.meta` is unavailable in specs and in the config; the project is transpiled to
  CommonJS. Use `process.cwd()` or `E2E_REPO_ROOT` to reach the repository root.
- Install with the pinned npm: `npx --yes npm@10.9.2 install`. A newer global npm fails on
  this repository, both with an arborist crash and with `EALLOWREMOTE` on the remote-tarball
  `xlsx` dependency.
- The e2e directory is its own npm project, separate from `frontend/`.

## Verify

```bash
./e2e/scripts/run.sh
```

Failures write a trace, screenshot and video under `e2e/test-results/`, plus a
`error-context.md` containing the page's accessibility tree at the moment of failure —
that file is usually the fastest way to find the right selector.

`npx playwright show-trace <path>` replays a trace interactively.
