import { expect, login, test } from "./helpers";

/**
 * Issue #23: role tiers in the admin area.
 *
 * The control is gated on the *viewer's* own tier, not the target user's, so
 * the interesting cases are the two that differ: a superuser sees the control
 * and can hand out a tier, and a plain admin does not see it and cannot send
 * one even by crafting a request.
 */

const ROLE_CONTROL = "#user-role";

/** The user form lives in a slide-over panel that starts closed. */
async function openCreateForm(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Новый пользователь" }).click();
  await expect(
    page.getByRole("heading", { name: "Новый пользователь" }),
  ).toBeVisible();
}

test.describe("admin role tiers", () => {
  test("a superuser sees the role control", async ({ page }) => {
    await login(page);
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "Пользователи" }),
    ).toBeVisible();

    await openCreateForm(page);
    await expect(page.getByText("Роль", { exact: true }).first()).toBeVisible();
    await expect(page.locator(ROLE_CONTROL)).toBeVisible();
  });

  test("the role control offers every tier with a Russian label", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/users");

    await openCreateForm(page);
    await page.locator(ROLE_CONTROL).click();
    const options = page.getByRole("listbox").getByRole("option");
    await expect(options).toHaveText([
      "Пользователь",
      "Администратор",
      "Суперпользователь",
    ]);
  });

  test("a superuser can create a user with a tier and the tier is sent", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/users");

    const username = `e2e-admin-${Date.now()}`;
    await openCreateForm(page);
    await page.locator("#first-name").fill("Тинь");
    await page.locator("#last-name").fill("Тайнов");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill("e2ecreated12345");

    await page.locator(ROLE_CONTROL).click();
    await page.getByRole("option", { name: "Администратор" }).click();
    await page.getByRole("button", { name: "Сохранить" }).click();

    const row = page.locator("tr", { hasText: username });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("Администратор");
  });

  test("a non-superuser does not see the role control and is refused the admin area", async ({
    page,
    browser,
  }) => {
    // Create a plain admin through the superuser's session, then sign in as them.
    await login(page);
    await page.goto("/admin/users");
    const username = `e2e-plain-${Date.now()}`;
    await openCreateForm(page);
    await page.locator("#first-name").fill("Пло");
    await page.locator("#last-name").fill("Ском");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill("e2ecreated12345");
    await page.locator(ROLE_CONTROL).click();
    await page.getByRole("option", { name: "Администратор" }).click();
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("tr", { hasText: username })).toBeVisible({
      timeout: 15_000,
    });

    // Now sign in as that account in a fresh context.
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await other.goto("/login");
    await other.locator("#username").fill(username);
    await other.locator("#password").fill("e2ecreated12345");
    await other.getByRole("button", { name: "Войти" }).click();
    await expect(other.locator('.h1:has-text("Divaldi")')).toBeVisible();

    // An admin can reach the area, but must not see the tier control.
    await other.goto("/admin/users");
    await expect(
      other.getByRole("heading", { name: "Пользователи" }),
    ).toBeVisible();
    await other.getByRole("button", { name: "Новый пользователь" }).click();
    await expect(
      other.getByRole("heading", { name: "Новый пользователь" }),
    ).toBeVisible();
    await expect(other.locator(ROLE_CONTROL)).toHaveCount(0);

    await ctx.close();
  });

  test("a plain user is kept out of the admin area", async ({ page }) => {
    await login(page);
    await page.goto("/admin/users");

    const username = `e2e-basic-${Date.now()}`;
    await openCreateForm(page);
    await page.locator("#first-name").fill("Обыч");
    await page.locator("#last-name").fill("Ный");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill("e2ecreated12345");
    // Leave the tier at its default of "user".
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator("tr", { hasText: username })).toBeVisible({
      timeout: 15_000,
    });

    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill("e2ecreated12345");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.locator('.h1:has-text("Divaldi")')).toBeVisible();

    // authGuard + adminGuard send a non-admin away from /admin/users.
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/(create|chats)/);
  });
});
