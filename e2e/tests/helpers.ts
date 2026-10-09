import { execFileSync } from "node:child_process";

import { test as base, expect, type Page } from "@playwright/test";

export const E2E_USER = process.env.E2E_USERNAME ?? "e2e";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "e2epassword";

// The e2e directory sits directly under the repository root. `import.meta` is
// unavailable here because the config and specs are transpiled to CommonJS.
const REPO_ROOT = process.env.E2E_REPO_ROOT ?? `${process.cwd()}/..`;

/**
 * The compose flags every Docker call in this file must share.
 *
 * Must match the project and files `setup.sh` used. Compose resolves named
 * volumes, and the default project's Redis is the *developer's*: touching that
 * one leaves the e2e stack unchanged, so the suite trips its own limiter or
 * polls its own generation while clearing the developer's keys.
 */
function composeBase(): string[] {
  const project = process.env.E2E_PROJECT ?? "divaldi-e2e";
  if (!project || project === "divaldi") {
    throw new Error(
      `Refusing to run: E2E_PROJECT is "${project}", which is the development project. ` +
        "The e2e suite must run under its own project name or it shares the developer's volumes.",
    );
  }
  return [
    "compose",
    "-p",
    project,
    "-f",
    "docker-compose.yaml",
    "-f",
    "docker-compose.override.yml.e2e",
  ];
}

/**
 * Reset the backend's per-user rate-limit counters.
 *
 * `app/routes/chat.py` limits both chat creation and message sending to 5 per
 * minute per user (`chats:post`). The whole suite runs as a single seeded user,
 * so without this a run trips its own limiter: a chat is created, the message is
 * rejected with 429, and the create page never navigates. The counters live in
 * Redis, which the e2e stack owns, so clearing them between tests is legitimate
 * rather than a workaround.
 */
function clearRateLimits(): void {
  try {
    execFileSync(
      "docker",
      [
        ...composeBase(),
        "exec",
        "-T",
        "redis",
        "sh",
        "-c",
        'redis-cli --scan --pattern "ratelimit:*" | xargs -r redis-cli DEL',
      ],
      { cwd: REPO_ROOT, stdio: "ignore" },
    );
  } catch {
    // If Docker is not reachable from here the suite is already broken; failing
    // here would hide the real error from the test that follows.
  }
}

/**
 * Wait for any in-flight generation of the seeded user to finish.
 *
 * `POST /chats/` answers 409 while `chat:generation:*` exists, and that key
 * lives until the worker pipeline (parse, generate, spreadsheet, S3) drains.
 * A test that only asserts on the DOM can finish while the previous test's
 * generation is still running, so the next `createChat` is refused and fails
 * on navigation with no mention of a lock. Polling here serialises the suite
 * against the backend's own lock; on a fast machine the key is already gone
 * and this is a single Redis round trip. Bounded: on timeout the test runs
 * anyway and surfaces the 409 itself.
 */
function waitForIdleGeneration(): void {
  const deadline = Date.now() + 120_000;
  for (;;) {
    let outstanding = "";
    try {
      outstanding = execFileSync(
        "docker",
        [
          ...composeBase(),
          "exec",
          "-T",
          "redis",
          "redis-cli",
          "--scan",
          "--pattern",
          "chat:generation:*",
        ],
        {
          cwd: REPO_ROOT,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
    } catch {
      // Same reasoning as above: a Docker failure here must not mask the test.
      return;
    }
    if (!outstanding) {
      return;
    }
    if (Date.now() > deadline) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
}

export const test = base.extend({
  // The app shell's brand mark. It is a `div`, not a heading.
  appReady: [
    async ({ page }, use) => {
      waitForIdleGeneration();
      clearRateLimits();
      await use(page);
    },
    { auto: true },
  ],
});

export { expect };

/** Log in through the real form and wait for the app shell. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#username").fill(E2E_USER);
  await page.locator("#password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.locator('.h1:has-text("Divaldi")')).toBeVisible();
}

/**
 * Create a chat session and land inside it.
 *
 * Several features live only on the chat view, so a spec has to get into a real
 * session rather than stopping on the create page that `login` lands on.
 */
export async function createChat(
  page: Page,
  description = "Кронштейн 200x100 мм, ст3 1 мм",
): Promise<string> {
  await page.goto("/create");
  await expect(
    page.getByRole("heading", { name: "Создать заявку" }),
  ).toBeVisible();
  await page.locator("#description").fill(description);
  await page.getByRole("button", { name: /Создать заявку/ }).click();
  await expect(page).toHaveURL(/\/chats\/.+/);
  await expect(page.getByText(description)).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop() as string;
}

/** Open the create-request page. */
export async function gotoCreate(page: Page): Promise<void> {
  await page.goto("/create");
  await expect(
    page.getByRole("heading", { name: "Создать заявку" }),
  ).toBeVisible();
}
