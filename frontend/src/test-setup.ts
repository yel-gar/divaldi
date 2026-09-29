/**
 * Global test setup, wired through the `setupFiles` option of the
 * `@angular/build:unit-test` test target in `angular.json`.
 *
 * Why this exists
 * ---------------
 * The test environment runs on jsdom, but `globalThis.localStorage` is
 * `undefined` in it, even though jsdom itself implements Web Storage and a
 * bare `new JSDOM(url)` exposes it correctly. Verified with a throwaway
 * probe: `typeof window === 'object'`, `document.URL` is
 * `http://localhost:3000/`, yet reading `localStorage` yields `undefined`
 * rather than throwing the "opaque origins" SecurityError.
 *
 * This only breaks specs that touch storage. `ThemeService` reads
 * `localStorage` in a field initializer and `Sidebar` is its only consumer,
 * so `sidebar.component.spec.ts` was the single spec that failed, with
 * `Cannot read properties of undefined (reading 'getItem')` and a cascade
 * of 14 errors from the `afterEach` avatar flush.
 *
 * Production code is not the problem: in a real browser `localStorage`
 * always exists. This is a gap in the test environment, so it is fixed
 * here rather than by adding defensive branches to application code.
 *
 * If a future Angular or Vitest upgrade makes jsdom's storage visible, this
 * file becomes a no-op: it only installs the shim when storage is missing.
 */

/** Minimal in-memory `Storage`, sufficient for the `localStorage` API surface. */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }

  [name: string]: unknown;
}

const target = globalThis as unknown as Record<string, unknown>;

if (typeof target['localStorage'] === 'undefined') {
  const storage = new MemoryStorage();
  Object.defineProperty(target, 'localStorage', {
    value: storage,
    configurable: true,
    writable: false
  });
}

// Same gap applies to sessionStorage; install it for symmetry so a future
// spec does not rediscover this.
if (typeof target['sessionStorage'] === 'undefined') {
  Object.defineProperty(target, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: false
  });
}
