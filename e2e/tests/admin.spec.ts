import { expect, login, test } from "./helpers";

/**
 * The admin area, reached with the superuser created by the e2e setup script.
 *
 * The users table and the create/edit form sit side by side; the form is always
 * visible and switches between "Новый пользователь" and "Редактирование
 * пользователя" rather than opening in a dialog.
 */
test.describe("admin", () => {
  test("lists users and filters them by name", async ({ page }) => {
    await login(page);
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "Пользователи" }),
    ).toBeVisible();

    await expect(
      page.locator(".users-table__username", { hasText: "e2e" }).first(),
    ).toBeVisible();

    await page.locator("#user-search").fill("no-such-user-anywhere");
    await expect(page.getByText("Пользователи не найдены")).toBeVisible();

    await page.locator("#user-search").fill("e2e");
    await expect(page.locator(".users-table__username").first()).toBeVisible();
  });

  test("creates a user, edits it and deletes it", async ({ page }) => {
    await login(page);
    await page.goto("/admin/users");

    const username = `e2e-created-${Date.now()}`;

    await expect(
      page.getByRole("heading", { name: "Новый пользователь" }),
    ).toBeVisible();
    await page.locator("#first-name").fill("Тест");
    await page.locator("#last-name").fill("Пользователь");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill("e2ecreated12345");
    // The submit button is labelled "Сохранить" in both create and edit mode.
    await page.getByRole("button", { name: "Сохранить" }).click();

    const row = page.locator("tr", { hasText: username });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Editing switches the form into edit mode and repopulates it.
    await row.getByRole("button", { name: "Редактировать" }).click();
    await expect(
      page.getByRole("heading", { name: "Редактирование пользователя" }),
    ).toBeVisible();
    await expect(page.locator("#username")).toHaveValue(username);

    // Deletion goes through the native window.confirm, which Playwright exposes
    // as a dialog handler rather than a DOM element.
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "Удалить" }).click();

    await expect(page.locator("tr", { hasText: username })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
