---
name: angular
description: Conventions for Angular 21 components, signals, services, templates and SCSS in the divaldi frontend. Use when writing or changing anything under frontend/src/app/.
---

# Angular — divaldi conventions

Angular 21.2 standalone, signals, TypeScript 5.9 strict, SCSS, Vitest 4.

## Folder tiers

| Folder | Holds |
|---|---|
| `core/` | singletons: `services/`, `guards/`, `interceptors/`, `models/` |
| `features/` | route-level feature areas (`calculation-chat/`, `order-create/`) |
| `pages/` | routed pages (`login-page/`, `history-page/`, `profile-page/`, `admin/`) |
| `shared/` | reusable components and utils |

## Component shape

```typescript
@Component({
  selector: 'app-thing',
  imports: [],
  templateUrl: './thing.component.html',
  styleUrl: './thing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThingComponent {
  readonly id = input.required<string>();
  readonly label = computed(() => `Thing ${this.id()}`);
}
```

- Selector prefix **`app-`**, kebab-case, enforced by ESLint. Directives use `app` camelCase.
- `styleUrl` is singular, referencing one `.component.scss` beside the template.
- Files are always `<kebab-name>.component.ts`.
- Class naming is inconsistent by history: some classes end in `Component`, some do not
  (`HistoryPage`, `Layout`, `Sidebar`). Follow the file you are editing; prefer the
  `Component` suffix for new classes.

## State: signals only

No NgRx or Redux. Use `signal()`, `computed()`, `effect()`, `afterRenderEffect()`,
`toSignal()` and `takeUntilDestroyed()`. Services are `@Injectable({ providedIn: 'root' })`.

- **List refresh uses a version signal**, not an event bus:
  `ChatService.historyVersion = signal(0)`, bumped by the service and read by the sidebar to
  re-fetch.
- **Cross-component handoff uses one-shot state services** with `set()` / `consume()`, for
  example `InitialChatStateService` passing an order description from the create page into the
  chat.
- `withComponentInputBinding()` is enabled, so route params arrive as `input()` signals.

## API layer

```typescript
const url = `${environment.apiUrl}/chats`;
```

- **Never hardcode a backend URL.** `apiUrl` comes from `src/environments/environment*.ts`;
  `docker/rewrite-env.mjs` rewrites the `__BACKEND_URL__` placeholder at image build time.
- Auth is cookie-based; `credentialsInterceptor` sets `withCredentials: true` on every request.
- The backend API contract is mirrored manually in `core/models/models.ts`. There is **no
  generated OpenAPI client**, so update both sides together.

## Polling, not WebSockets

Chat results poll `GET /chats/{id}/result` every 2 s with a 5 min timeout
(`POLL_INTERVAL_MS`, `POLL_TIMEOUT_MS`). Upload status polls every 2 s up to 150 attempts
(`AttachmentUploadService`, `STATUS_POLL_INTERVAL_MS`, `STATUS_POLL_LIMIT`). Respect these
constants rather than inventing new intervals.

## Forms

Reactive forms only, via `FormBuilder` / `NonNullableFormBuilder` with `Validators`. Custom
controls implement `ControlValueAccessor`: see `InputComponent`, `Textarea`, `Select`,
`CheckboxComponent`, `ToggleComponent`.

## Styling

- **CSS custom properties only** for colours. Light theme in `:root`, dark theme in
  `html[data-theme='dark']`; `ThemeService` sets the attribute and persists
  `localStorage['theme']`.
- BEM-style modifiers: `.button--main`, `.card--shadow`, `.input--error`.
- Global partials are `@use`d from `src/app/styles.scss`: `_fonts`, `_buttons`, `_forms`,
  `_markdown`, `_skeletons`, `_mixins as *`.
- `@use '...' as *` with relative paths and **no file extension**.
- Global utility classes: `.h1` to `.h5`, `.section`, `.card`, `.photo`, `.active-link`,
  `.visually-hidden`, `.required`.

## Icons

`@lucide/angular`. Import icons individually (`LucideDynamicIcon`, `LucideIcon`,
`LucideIconData`). The product logo is a custom SVG at `public/assets/svgs/logo.svg`.

## Language

All user-facing strings are **Russian**: labels, aria-labels, route `data.title`,
notifications. Code identifiers stay English.

## Tests

- Colocated `*.spec.ts`, using Vitest globals (`describe`, `it`, `expect`) with
  `import { vi } from 'vit'` where needed.
- `tsconfig.app.json` excludes `src/**/*.spec.ts`; `tsconfig.spec.json` includes them and sets
  `types: ["vitest/globals"]`.
- Services: `TestBed` with `provideRouter([])`, `provideHttpClient()`,
  `provideHttpClientTesting()`, plus `afterEach(() => http.verify())`.
- Components: `ComponentFixture`, `By` queries, inline `TestHost` components, hand-rolled
  fakes instead of HTTP mocks.
- **Angular schematics set `skipTests: true`**, so `ng generate component` will not create a
  spec. Write it by hand when the component has logic.

## Gotchas

- ESLint lints `src/**/*.ts` and `src/**/*.html` but **not `.scss`**, and there is no
  stylelint. A bad SCSS rule is caught by no gate.
- `npm test` is **not** run in CI; CI runs only `ng lint` and `ng build`. Run the tests
  yourself before claiming they pass.
- The dev override bind-mounts `./frontend` over `/app`. A stale or partially populated
  `node_modules` there makes `ng serve` fail in ways that look like source errors.

## Verify

```bash
npm --prefix frontend run lint
npm --prefix frontend run format
npm --prefix frontend test
npm --prefix frontend run build      # also typechecks; strictTemplates is on
```

Add dependencies with `npm install <pkg>` or `npm install -D <pkg>` from `frontend/`, and
commit `frontend/package-lock.json`.
