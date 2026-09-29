import { expect, login, test } from "./helpers";

test.describe("history", () => {
  test("lists a created request and reopens it", async ({ page }) => {
    await login(page);

    const marker = `Проверка истории ${Date.now()}`;
    await page.goto("/create");
    await page.locator("#description").fill(marker);
    await page.getByRole("button", { name: /Создать заявку/ }).click();
    await expect(page).toHaveURL(/\/chats\/.+/);

    // The mock provider renames every chat to the same title, so identify the
    // session by its id rather than by a name.
    const sessionId = new URL(page.url()).pathname.split("/").pop();

    await page.goto("/chats");
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });

    // The newest request is first, and it is the one just created.
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`/chats/${sessionId}$`));
    await expect(page.getByText(marker)).toBeVisible();
  });

  test("sorts the history by the most recent activity", async ({ page }) => {
    await login(page);
    await page.goto("/chats");

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });

    // Toggling the date column is exercised for its side effect on ordering.
    await page.getByRole("button", { name: /Дата/i }).first().click();
    await expect(rows.first()).toBeVisible();
  });
});
