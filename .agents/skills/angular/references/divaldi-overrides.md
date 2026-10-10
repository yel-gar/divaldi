# divaldi overrides for the generic Angular skill

The upstream `SKILL.md` in this directory is the generic Angular guide. **Where it
disagrees with this file, this file wins.**

Read this before writing any component, service, template or stylesheet.

---

## 1. Version and rendering: 21.2, client-side only

Divaldi is **Angular 21.2** standalone with signals, targeting **ES2022**.

- **No SSR, no hydration, no prerendering.** The generic guide covers these extensively;
  none of it applies. There is no `provideClientHydration()` and no server build.
- **No NgModules.** Everything is standalone; `standalone: true` is the default in v21 and
  does not need restating (some older files still do; leave them alone).
- **No NgRx or Redux.** Signals plus RxJS only.
- Do **not** migrate to zoneless change detection as part of unrelated work. The app runs
  zone-based; that is not in scope.

## 2. Folder tiers

| Folder | Holds |
|---|---|
| `core/` | singletons: `services/`, `guards/`, `interceptors/`, `models/` |
| `features/` | route-level feature areas (`calculation-chat/`, `order-create/`) |
| `pages/` | routed pages (`login-page/`, `history-page/`, `profile-page/`, `admin/`) |
| `shared/` | reusable components and utils |

## 3. State conventions

- `signal()`, `computed()`, `effect()`, `afterRenderEffect()`, `toSignal()`,
  `takeUntilDestroyed()`. Services are `@Injectable({ providedIn: 'root' })`.
- **List refresh uses a version signal**, not an event bus:
  `ChatService.historyVersion = signal(0)`, bumped by the service, read by the sidebar.
- **Cross-component handoff uses one-shot state services** with `set()` / `consume()`, e.g.
  `InitialChatStateService`.
- `withComponentInputBinding()` is enabled, so route params arrive as `input()` signals.

## 4. Templates and styles

- Selector prefix **`app-`** kebab-case, enforced by ESLint. Directives: `app` camelCase.
- `ChangeDetectionStrategy.OnPush`.
- `styleUrl` singular, one `.component.scss` beside the template.
- Files are always `<kebab-name>.component.ts`.
- **Class naming is inconsistent by history**: some end in `Component`
  (`CalculationChatComponent`), some do not (`HistoryPage`, `Layout`, `Sidebar`). Follow the
  file you are editing; prefer `Component` for new classes.
- **Colours come only from CSS custom properties.** Light theme in `:root`, dark theme in
  `html[data-theme='dark']`, persisted by `ThemeService` to `localStorage['theme']`. Never
  hardcode a hex.
- BEM-style modifiers: `.button--main`, `.card--shadow`, `.input--error`.
- `@use '...' as *` with relative paths and **no file extension**. Global partials live in
  `src/app/`: `_fonts`, `_buttons`, `_forms`, `_markdown`, `_skeletons`, `_mixins`.
- **No Tailwind, no CSS modules, no styled-components.** Plain SCSS only.

## 5. API layer

- Services build URLs as `` `${environment.apiUrl}/chats` ``.
- **Never hardcode a backend URL.** `environment.prod.ts` holds the placeholder
  `apiUrl: '__BACKEND_URL__/api/v1'`, rewritten at image build time by
  `docker/rewrite-env.mjs` from the `BACKEND_URL` build arg.
- Dev proxying goes through `proxy.conf.js` (`/api` -> `BACKEND_PROXY` or
  `localhost:3000`). It is a JS module rather than JSON precisely so the target
  stays overridable via the environment.
- Auth is cookie-based; `credentialsInterceptor` sets `withCredentials: true`.
- The backend contract is mirrored by hand in `core/models/models.ts`. There is **no
  generated OpenAPI client**; update both sides together.

## 6. Polling, not WebSockets

- Generation results: `POLL_INTERVAL_MS = 2000`, `POLL_TIMEOUT_MS = 5 * 60 * 1000`.
- Upload status: `STATUS_POLL_INTERVAL_MS = 2000`, `STATUS_POLL_LIMIT = 150`.

Respect these constants. The 5-minute timeout followed by a visible state is intentional;
do not extend it to hide a stuck worker.

## 7. Heavy dependencies stay lazy

`docx-preview`, `xlsx` and `hyperformula` are dynamically `import()`ed inside
`file-preview.component.ts`. Promoting any of them to a static top-level import pulls them
into the eager bundle for every user. See the `frontend-file-preview` skill.

## 8. Forms and icons

Reactive forms only, via `FormBuilder` / `NonNullableFormBuilder` with `Validators`. Custom
controls implement `ControlValueAccessor` (`InputComponent`, `Textarea`, `Select`,
`CheckboxComponent`, `ToggleComponent`).

Icons come from `@lucide/angular`. The product logo is a custom SVG at
`public/assets/svgs/logo.svg`.

## 9. Language

**All user-facing strings are Russian**: labels, aria-labels, route `data.title`,
notifications. Code identifiers stay English.

## 10. Tests

- Colocated `*.spec.ts`, Vitest globals; `import { vi } from 'vitest'` where needed.
- **Schematics set `skipTests: true`**, so `ng generate component` creates no spec. Write it
  by hand when the component has logic.
- Services: `TestBed` with `provideRouter([])`, `provideHttpClient()`,
  `provideHttpClientTesting()`, plus `afterEach(() => http.verify())`.
- Components: `ComponentFixture`, `By` queries, inline `TestHost`, hand-rolled fakes.
- `strictTemplates` is on. Type safety in templates is not optional.

## 11. Tooling

- ESLint lints `src/**/*.ts` and `src/**/*.html` but **not `.scss`**, and there is no
  stylelint. A bad SCSS rule is caught by no gate.
- **The suite runs in CI** via `npx ng test --watch=false` in `frontend-ci.yml`, alongside
  `ng lint` and `ng build`. Pass `--watch=false` explicitly: the builder defaults watch mode
  to `true` in TTY environments, so an interactive run would otherwise hang. The suite is
  154 tests across 20 files.
- **`src/test-setup.ts` supplies Web Storage.** The jsdom test environment exposes no
  `localStorage` or `sessionStorage`, and `ThemeService` reads `localStorage` in a field
  initializer, so specs touching the sidebar fail without it. The shim is registered via the
  builder's `setupFiles` option and only installs when storage is missing. Do not add
  `typeof localStorage` guards to application code to work around this.
- Prettier: single quotes, `printWidth` 100, `trailingComma` none.
- **Use the pinned npm, not the global one.** `package.json` pins
  `packageManager: npm@10.9.2`. Newer global npm versions fail on this project, once with an
  arborist crash and once with `EALLOWREMOTE` because of the remote-tarball `xlsx`
  dependency. Install with `npx --yes npm@10.9.2 install <pkg>`.
- **Coverage is configured on the `test` target in `angular.json`,** via the builder's
  native `coverage` options. Do not add a `vitest.config.ts`: the
  `@angular/build:unit-test` builder owns the Vitest configuration. The provider
  `@vitest/coverage-v8` must match the installed Vitest major version, currently `4.1.11`,
  so a bare install pulling the v5 line is wrong.
- Add dependencies with **`npm install <pkg>`** from `frontend/`, then commit
  `frontend/package-lock.json`.

## 12. Verify

```bash
npm --prefix frontend run lint
npm --prefix frontend run format
npm --prefix frontend test
npm --prefix frontend run build      # also typechecks
```
