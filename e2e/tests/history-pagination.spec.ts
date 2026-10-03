import { execFileSync } from "node:child_process";

import { expect, login, test } from "./helpers";

/**
 * Issue #51: the chat list became a paginated envelope.
 *
 * Two things are worth proving here that unit tests cannot. First, that the
 * envelope the backend returns actually renders as rows, because the history
 * page was rewritten to read `items` where it used to read a bare array. Second,
 * that sorting is now a *server* round trip: before #51 the page sorted the whole
 * array in a computed, which stopped being possible once only one page was in
 * memory.
 *
 * The pager only renders when there are more rows than a page holds, so the
 * paging tests seed enough sessions to cross that line. They are seeded straight
 * into PostgreSQL rather than through the UI because chat creation is rate
 * limited to 5 per minute and each one would queue a real generation; the seed
 * is the same thing the e2e setup script does for the superuser.
 */

const PAGE_SIZE = 20;
const REPO_ROOT = process.env.E2E_REPO_ROOT ?? `${process.cwd()}/..`;

// Must match the project `setup.sh` used. Compose prefixes named volumes with
// the project name, so the wrong value here would seed the developer's database
// instead of the throwaway e2e one.
const E2E_PROJECT = process.env.E2E_PROJECT ?? "divaldi-e2e";

/** Insert `count` sessions with one user message each, owned by `username`. */
function seedChats(username: string, count: number): void {
  // Fail loudly rather than write to the wrong database. Compose prefixes
  // volumes with the project name, so a mismatch means the dev stack.
  if (!E2E_PROJECT || E2E_PROJECT === "divaldi") {
    throw new Error(
      `Refusing to seed: E2E_PROJECT is "${E2E_PROJECT}", which is the development project. ` +
        "The e2e suite must run under its own project name or it writes into the dev database.",
    );
  }

  const sql = `
    DO $$
    DECLARE
      uid integer;
      sid uuid;
      i integer;
    BEGIN
      SELECT id INTO uid FROM users WHERE username = '${username}';
      IF uid IS NULL THEN
        RAISE EXCEPTION 'no such user: ${username}';
      END IF;
      FOR i IN 1..${count} LOOP
        -- gen_random_uuid per row; capture it so the message lands in this
        -- session rather than an arbitrary one with the same name.
        INSERT INTO chat_sessions (name, session_id, user_id)
        VALUES ('Пейджер ' || i, gen_random_uuid(), uid)
        RETURNING session_id INTO sid;

        INSERT INTO chat_messages (chat_session_id, role, content, display_text, timestamp)
        VALUES (sid, 'USER', 'Пейджер ' || i, 'Пейджер ' || i, now() - (i || ' minutes')::interval);
      END LOOP;
    END $$;
  `;
  execFileSync(
    "docker",
    [
      "compose",
      "-p",
      E2E_PROJECT,
      // Match setup.sh: name the override explicitly rather than relying on the
      // developer's docker-compose.override.yml being the right one.
      "-f",
      "docker-compose.yaml",
      "-f",
      "docker-compose.override.yml.e2e",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "divaldi",
      "-d",
      "divaldi",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: REPO_ROOT, stdio: "ignore" },
  );
}

test.describe("history pagination", () => {
  test("the list request carries pagination parameters and renders an envelope", async ({
    page,
  }) => {
    await login(page);

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) =>
          r.url().includes("/api/v1/chats/") &&
          r.url().includes("page=0") &&
          r.url().includes(`items_per_page=${PAGE_SIZE}`),
      ),
      page.goto("/chats"),
    ]);

    const url = new URL(request.url());
    expect(url.searchParams.get("page")).toBe("0");
    expect(url.searchParams.get("items_per_page")).toBe(String(PAGE_SIZE));

    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("sorting re-requests from the server instead of sorting in the browser", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/chats");
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 15_000,
    });

    // Before #51 this click only reordered a computed. Now it must hit the API,
    // and it must reset to the first page because page 2 of the old order is not
    // page 2 of the new one.
    const [request] = await Promise.all([
      page.waitForRequest(
        (r) =>
          r.url().includes("/api/v1/chats/") &&
          r.url().includes("sort=") &&
          r.url().includes(`items_per_page=${PAGE_SIZE}`),
      ),
      page.getByRole("button", { name: /Дата/i }).first().click(),
    ]);

    const url = new URL(request.url());
    expect(url.searchParams.get("sort")).toBeTruthy();
    expect(url.searchParams.get("page")).toBe("0");
  });

  test("the pager appears once there are more rows than a page holds", async ({
    page,
  }) => {
    await login(page);
    seedChats("e2e", PAGE_SIZE + 3);

    await page.goto("/chats");
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });

    const pager = page.locator(
      'nav[aria-label="Постраничная навигация по истории заявок"]',
    );
    await expect(pager).toBeVisible();
    await expect(pager.locator(".pagination__status")).toHaveText(
      /Страница 1 из \d+/,
    );

    // First page holds a full page and Вперёд is available; Назад is not.
    await expect(pager.getByRole("button", { name: "Назад" })).toBeDisabled();
    await expect(pager.getByRole("button", { name: "Вперёд" })).toBeEnabled();
  });

  test("the pager moves to the next page and back", async ({ page }) => {
    await login(page);
    seedChats("e2e", PAGE_SIZE + 3);

    await page.goto("/chats");
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 30_000,
    });

    const pager = page.locator(
      'nav[aria-label="Постраничная навигация по истории заявок"]',
    );
    await expect(pager).toBeVisible();

    const firstRow = await page.locator("tbody tr").first().innerText();

    const [forwardRequest] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("page=1")),
      pager.getByRole("button", { name: "Вперёд" }).click(),
    ]);
    expect(new URL(forwardRequest.url()).searchParams.get("page")).toBe("1");
    await expect(pager.locator(".pagination__status")).toHaveText(
      /Страница 2 из/,
    );

    // The rows must actually differ, which is the point of paging.
    await expect(page.locator("tbody tr").first()).not.toHaveText(firstRow);

    const [backRequest] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("page=0")),
      pager.getByRole("button", { name: "Назад" }).click(),
    ]);
    expect(new URL(backRequest.url()).searchParams.get("page")).toBe("0");
    await expect(pager.locator(".pagination__status")).toHaveText(
      /Страница 1 из/,
    );
  });

  test("a page holds no more rows than the requested size", async ({
    page,
    browser,
  }) => {
    await login(page);
    seedChats("e2e", PAGE_SIZE + 3);

    await page.goto("/chats");
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 30_000,
    });

    const api = await browser.newContext({
      storageState: await page.context().storageState(),
    });

    const first = await (
      await api.request.get("/api/v1/chats/?page=0&items_per_page=5")
    ).json();
    const second = await (
      await api.request.get("/api/v1/chats/?page=1&items_per_page=5")
    ).json();

    // The envelope, not a bare list.
    expect(Array.isArray(first)).toBe(false);
    expect(first).toHaveProperty("items");
    expect(first).toHaveProperty("total");
    expect(first.page).toBe(0);
    expect(first.items_per_page).toBe(5);

    expect(first.items.length).toBeLessThanOrEqual(5);
    expect(second.page).toBe(1);
    expect(first.total).toBe(second.total);
    // No row may appear on both pages.
    const ids = new Set(
      first.items.map((c: { session_id: string }) => c.session_id),
    );
    for (const chat of second.items) {
      expect(ids.has(chat.session_id)).toBe(false);
    }

    await api.close();
  });
});
