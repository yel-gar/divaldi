import { execFileSync } from "node:child_process";

import { test as base, expect, type Page } from "@playwright/test";

export const E2E_USER = process.env.E2E_USERNAME ?? "e2e";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "e2epassword";

// The e2e directory sits directly under the repository root. `import.meta` is
// unavailable here because the config and specs are transpiled to CommonJS.
const REPO_ROOT = process.env.E2E_REPO_ROOT ?? `${process.cwd()}/..`;

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
        "compose",
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

export const test = base.extend({
  // The app shell's brand mark. It is a `div`, not a heading.
  appReady: [
    async ({ page }, use) => {
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
