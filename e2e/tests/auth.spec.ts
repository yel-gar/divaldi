import { E2E_PASSWORD, E2E_USER, expect, login, test } from "./helpers";

test.describe("authentication", () => {
  test("rejects a wrong password with a visible message", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#username").fill(E2E_USER);
    await page.locator("#password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Войти" }).click();

    // A failed login raises a toast, not an inline field error.
    await expect(
      page.getByText("Перепроверьте правильность введённого логина и пароля"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in and lands on the app", async ({ page }) => {
    await login(page);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("sends an unauthenticated visitor to the login page", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/chats");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs out", async ({ page }) => {
    await login(page);
    await page
      .getByRole("button", { name: /Выйти|Выход|logout/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login/);
  });
});
